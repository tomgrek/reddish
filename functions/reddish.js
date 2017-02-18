(function() {
  const redis = require("redis");
  let io; // user must call initSocket

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

  const setUnion = require('./dbFunctions.js').setUnion;

  const initSocket = function(ioInstance) {
    io = ioInstance;

    io.on('connection', (socket) => {
      socket.on('disconnect', () => {
        for (listenerKey of Object.keys(this.listeners)) {
          // kill dead listener sockets when client disconnects
          let newSockets = [];
          let newQueries = [];
          for (let i = 0; i < this.listeners[listenerKey].sockets.length; i++) {
            if (this.listeners[listenerKey].sockets[i].id !== socket.id) {
              newSockets.push(this.listeners[listenerKey].sockets[i]);
              newQueries.push(this.listeners[listenerKey].queries[i]);
            }
          }
          this.listeners[listenerKey].sockets = newSockets;
          this.listeners[listenerKey].queries = newQueries;
        }
      });

      socket.on('fetchNLinked', query => {
        query = JSON.parse(query);
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
                if (this.listeners[key]) {
                  this.listeners[key].sockets.push(socket);
                  this.listeners[key].queries.push(query);
                } else {
                  subs[key].psubscribe("__keyspace@0__:" + key);
                  this.listeners[key] = {db: subs[key], sockets: [socket], queries: [query]};
                  this.listeners[key].db.on('pmessage',(a,b,c) => {
                    if (b.slice(15) !== key) return;
                    for (let i = 0; i < this.listeners[key].sockets.length; i++) {
                      let activeQuery = this.listeners[key].queries[i];
                      let listeningSocket = this.listeners[key].sockets[i];
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
  };

  let thisContext = {
    listeners: listeners
  };
  module.exports = {
   initSocket: initSocket.bind(thisContext),
  }

})();

;
