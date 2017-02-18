function main() {
    const path = require('path');
    const express = require('express');
    const webpack = require('webpack');
    const webpackMiddleware = require('webpack-dev-middleware');
    const webpackHotMiddleware = require('webpack-hot-middleware');
    const config = require('../webpack.config.js');
    const isDeveloping = process.env.NODE_ENV !== 'production';

    const passport = require('passport');
    const LocalStrategy = require('passport-local').Strategy;
    const User = require('../models/User.js');
    const bodyParser = require('body-parser');

    const redis = require("redis");
    const redisClientForSessions = redis.createClient();

    // error logging - you may want to handle this differently
    redisClientForSessions.on('error',console.error);
    // close the database connection on process exit
    var gracefulExit = function() {
      redisClientForSessions.quit();
      console.log('Database connection safely closed.');
      process.exit(0);
    }
    process.on('SIGINT', gracefulExit).on('SIGTERM', gracefulExit);

    // default port is 3000, unless you've set an environment variable
    const port = isDeveloping ? 3000 : process.env.PORT;
    // create the app (Express server)
    const app = express();
    const http = require('http');
    const server = http.Server(app);


    // serve static files - JS, CSS, fonts etc - from the public directory
    // e.g. on the filesystem /home/app/public/jquery.js would become http://localhost:3000/jquery.js
    app.use(express.static('public'));

    // all this code is for mongo session store for express, and passport.js for users/login
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({extended:true}));
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
    const expressSession = require('express-session');
    const RedisStore = require('connect-redis')(expressSession);
    const sessionStore = new RedisStore({client: redisClientForSessions});
    app.use(expressSession({ secret: 'mysecret', resave:true, saveUninitialized:true, store: sessionStore}));
    app.use(passport.initialize());
    app.use(passport.session());

    passport.serializeUser(function(user, done) {
      done(null, user.id);
    });
    passport.deserializeUser(function(id, done) {
      User.findById(id, function(err, user) {
        done(null, user);
      }, redisClientForSessions);
    });
    passport.use(new LocalStrategy(function(username, password, done) {
      User.findOne({ username: username }, function (err, user) {
        if (err) { return done(err); }
        if (!user) { return done(null, false); }
        if (!user.validPassword(password)) { return done(null, false); }
        return done(null, user);
      }, redisClientForSessions);
    }));

    //socket
    const io = require('socket.io')(server);
    const passportSocketIo = require('passport.socketio');

    function onAuthorizeFail(data, message, error, accept){
      // accept all connections - do the auth check inside socket.on
      //if(error) throw new Error(message);
      return accept();
    }

    io.use(passportSocketIo.authorize({
      key: 'connect.sid',
      secret: 'mysecret',
      store: sessionStore,
      passport: passport,
      cookieParser: cookieParser,
      fail: onAuthorizeFail
    }));

    const reddish = require('../functions/reddish.js');
    reddish.initSocket(io);

    // an example route
    app.get('/example_rest_endpoint/:id', function response(req, res) {
      console.log(req.user);
      res.write(`hello ${req.params.id}`); // or you can use res.json({some object})
      res.end();
    });

    app.get('/setcookie', (req, res) => {
      res.redirect('/');
    });

    app.post('/login',
    passport.authenticate('local', { failureRedirect: '/tryLogin/failed' }),
    function(req, res) {
      res.cookie('loggedin', req.user.username, {maxAge: 900000, httpOnly: false});
      res.redirect('/');
    });

    // bundle a bunch of useful things in if we're in dev mode (i.e. running on local machine)
    if (isDeveloping) {
      const compiler = webpack(config);
      const middleware = webpackMiddleware(compiler, {
        publicPath: config.output.publicPath,
        contentBase: 'src',
        stats: {
          colors: true,
          hash: false,
          timings: true,
          chunks: false,
          chunkModules: false,
          modules: false
        }
      });
      app.use(middleware);
      app.use(webpackHotMiddleware(compiler));
      // if the routes above didn't do anything, then just pass it to React Router
      app.get('*', function response(req, res) {
        res.write(middleware.fileSystem.readFileSync(path.join(__dirname, '../dist/index.html')));
        res.end();
      });

      // but if we're in production, do this instead:
      } else {
      app.use(express.static(__dirname + '../dist'));
      app.get('*', function response(req, res) {
          console.log(__dirname + '/..'+ req.url + 'its in our');
          res.sendFile(path.join(__dirname, '../dist/index.html'));
        });
      }

    server.listen(port, '0.0.0.0', function onStart(err) {
      if (err) {
        console.log(err);
      }
      console.info('Listening on port %s.', port);
    });
}

main();
