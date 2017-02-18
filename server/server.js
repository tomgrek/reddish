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

    const redisdb = redis.createClient(); // for pubsubs
    const redisEngine = redis.createClient(); // for queries
    let listeners = {};

    const fetchN = function({base, min, max, offset, count}) {
      return new Promise((resolve, reject) => {
        redisEngine.zrangebyscore([base, min, max, 'WITHSCORES', 'LIMIT', offset, count], (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    };

    const fetchLinked = function(query) {
      let retVal = query.score ? { score: query.score } : {};
      retVal.id = query.id;
      let promises = [];
      return new Promise((res, rej) => {
        for (var field of query.fields) {
          promises.push(new Promise((resolve, reject) => {
            redisEngine.get(query.base + ':' + field + ':' + query.id, (err, data) => {
              if (err) reject(err);
              else resolve(data);
            });
          }));
        }
        Promise.all(promises).then(v => {
          for (var i in query.fields) {
            retVal[query.fields[i]] = v[i];
          }
          res(retVal);
        });
      });
    };

    const setUnion = require('../functions/dbFunctions.js').setUnion;

    io.on('connection', (socket) => {

      socket.on('disconnect', () => {
        for (listenerKey of Object.keys(listeners)) {
          // kill dead listener sockets when client disconnects
          let newSockets = [];
          let newQueries = [];
          for (let i = 0; i < listeners[listenerKey].sockets.length; i++) {
            if (listeners[listenerKey].sockets[i].id !== socket.id) {
              newSockets.push(listeners[listenerKey].sockets[i]);
              newQueries.push(listeners[listenerKey].queries[i]);
            }
          }
          listeners[listenerKey].sockets = newSockets;
          listeners[listenerKey].queries = newQueries;
        }
      });

      socket.on('fetchNLinked', query => {
        query = JSON.parse(query);
        console.log(query);
        let promises = [];
        fetchN(query).then(res => {
          for (let i = 0; i < res.length; i += 2) {
            promises.push(fetchLinked({base: query.base, id: res[i], fields: query.fields, score: res[i+1]}));
          }
          Promise.all(promises).then(result => {
            socket.emit('results', {
              result: result,
              query: query,
              timeStamp: new Date()
            });
            let subs = [];
            for (var i = 0; i < query.fields.length; i++) {
              for (var j = 0; j < res.length; j++) {
                let key = query.base + ':' + query.fields[i] + ':' + result[j].id;
                subs[key] = redisdb;
                if (listeners[key]) {
                  listeners[key].sockets.push(socket);
                  listeners[key].queries.push(query);
                } else {
                  subs[key].psubscribe("__keyspace@0__:" + key);
                  listeners[key] = {db: subs[key], sockets: [socket], queries: [query]};
                  listeners[key].db.on('pmessage',(a,b,c) => {
                    if (b.slice(15) !== key) return;
                    for (let i = 0; i < listeners[key].sockets.length; i++) {
                      let activeQuery = listeners[key].queries[i];
                      let listeningSocket = listeners[key].sockets[i];
                      if (activeQuery.dontSendWholeSetOnUpdate) {
                        let splitKey = b.split(':');
                        let id = splitKey[splitKey.length - 1];
                        let field = splitKey[splitKey.length - 2];
                        fetchLinked({base: activeQuery.base, id: id, fields: activeQuery.fields}).then(v => {
                          listeningSocket.emit('newresult', {
                            results: v,
                            query: activeQuery,
                            field: field,
                            timeStamp: new Date()
                          });
                        });
                      } else {
                        fetchN(activeQuery).then(res => {
                          let promises = [];
                          for (let i = 0; i < res.length; i += 2) {
                            promises.push(fetchLinked({base: activeQuery.base, id: res[i], fields: activeQuery.fields, score: res[i+1]}));
                          }
                          Promise.all(promises).then(result => {
                            listeningSocket.emit('newresult', {
                              results: result,
                              query: activeQuery,
                              timeStamp: new Date()
                            });
                          });
                        });
                      }
                    }
                  });
                }
              }
            }
          });
        });
      });
      socket.on('fetchLinked', query => {
        query = JSON.parse(query);
        fetchLinked(query).then(res => {
          socket.emit('results', JSON.stringify({results: res, query: query, timeStamp: new Date()}));
          let subs = [];
          for (var key of Object.keys(res)) {
            subs[key] = redisdb;
            subs[key].psubscribe("__keyspace@0__:" + query.base + ':' + key + ':' + query.id);
            subs[key].on('pmessage',(a,b,c) => {
              if (query.dontSendWholeSetOnUpdate) {
                let keyName = b.split(':').slice(1);
                let field = setUnion(keyName, query.fields);
                redisdb.get(keyName.join(':'), (err, d) => {
                  socket.emit('newresult', {
                    results: d,
                    query: query,
                    field: field,
                    timeStamp: new Date()
                  });
                });
              } else {
                fetchLinked(query).then(d => {
                  socket.emit('newresult', {
                    results: d,
                    query: query,
                    timeStamp: new Date()
                  });
                });
              }
            });
          }

        });
      });

      // STILL TODO:
      // find and fetch (query keys articles.titles, then return fetched id)
      // insert (done!), update, delete
      // NEXT: integrate preact, modularize server side code, have server create
      // db schema with specified fields if it doesn't already exist.
      socket.on('insert', query => {
        query = JSON.parse(query);
        //if (socket.request.user && !socket.request.user.logged_in) return;
        let fields = Object.keys(query.item);
        if (query.item.id) {
          redisEngine.zadd([query.base, query.item.rank, query.item.id], console.log);
          for (var field of fields) {
            if (field === 'id') continue;
            redisEngine.set(query.base + ':' + field + ':' + query.item.id, JSON.stringify(query.item[field]));
            redisEngine.hset(query.base + '.' + field + '.index', JSON.stringify(query.item[field]), query.item.id);
          }
          query.id = query.item.id;
          query.fields = fields;
          query.score = query.item.rank;
          query.operation = 'insert';
          delete query.item;
          fetchLinked(query).then(res => {
            socket.emit('newresult', JSON.stringify({results: res, query: query, timeStamp: new Date()}));
          });
        }
      });

      socket.on('find', query => {
        if (socket.request.user && !socket.request.user.logged_in) return;
        // pub.keys("demo:data:*",(err, keys) => {
        //   keys.map(key => pub.hgetall(key, (err, d) => console.log(d.content)));
        // });
        redisEngine.hgetall(query, (err, d) => {
          socket.emit('results', d);
          let sub = redisdb; //redis.createClient();
          sub.psubscribe("__keyspace@0__:" + query);
          sub.on('pmessage',(a,b,c) => {
            // b contains the modified key - optimize by transmitting only that
            redisEngine.hgetall(query, (err, d) => {
              socket.emit('newresult', d);
            });
          });
        });
      });
    });


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
