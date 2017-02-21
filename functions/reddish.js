(function() {
  const redis = require("redis");
  const uuidv1 = require('uuid/v1');
  const _ = require('lodash');

  let io; // user must call initSocket

  const redisdb = redis.createClient(); // for pubsubs
  const redisEngine = redis.createClient(); // for queries
  let listeners = {};
  let subscriptions = [];

  const listenerFunction = (a,b,c) => {
    let key = b.split(':')[1];
    if (!listeners[key]) return;
    if (c === 'zadd') return;
    for (let i = 0; i < listeners[key].sockets.length; i++) {
    // room to optimize here -- don't transmit a newresult if the field
    // (get it from b) is not in the activeQuery.fields
    // also if the score of the new result is outside the query.min/max,
    // also if the offset/count has already been met by what we sent (or
    // do that bit on the client)
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
            timeStamp: new Date(),
            operation: 'update'
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
  };

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

  const initSocket = function(ioInstance) {
    io = ioInstance;

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
        let promises = [];
        fetchN(query).then(res => {
          for (let i = 0; i < res.length; i += 2) {
            promises.push(fetchLinked({base: query.base, id: res[i], fields: query.fields, score: Number.parseInt(res[i+1])}));
          }
          Promise.all(promises).then(result => {
            socket.emit('results', {
              result: result,
              query: query,
              timeStamp: new Date()
            });
            if (listeners[query.base]) {
              listeners[query.base].sockets.push(socket);
              listeners[query.base].queries.push(query);
            } else {
              redisdb.psubscribe("__keyspace@0__:" + query.base + "*");
              listeners[query.base] = {sockets: [socket], queries: [query]};
              if (_.find(subscriptions, (v) => v === query.base) === undefined) {
                redisdb.on('pmessage', listenerFunction);
                subscriptions.push(query.base);
              }
            }
          });
        });
      });
      // this just gets a single item
      socket.on('fetchLinked', query => {
        fetchLinked(query).then(res => {
          socket.emit('results', JSON.stringify({results: res, query: query, timeStamp: new Date()}));
          let subs = [];
          for (var key of Object.keys(res)) {
            subs[key] = redisdb;
            subs[key].psubscribe("__keyspace@0__:" + query.base + ':' + key + ':' + query.id);
            subs[key].on('pmessage',(a,b,c) => {
              if (query.dontSendWholeSetOnUpdate) {
                let keyName = b.split(':').slice(1);
                let field = _.intersection(keyName, query.fields)[0];
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
      // NEXT: have server create
      // db schema with specified fields if it doesn't already exist.
      socket.on('insert', query => {
        //if (socket.request.user && !socket.request.user.logged_in) return;
        let fields = Object.keys(query.item);
        if (query.item.id === undefined || query.item.id === null) {
          query.item.id = uuidv1();
        }
        redisEngine.zadd([query.base, query.item.score, query.item.id], ()=>{});
        for (var field of fields) {
          if (field === 'id') continue;
          redisEngine.set(query.base + ':' + field + ':' + query.item.id, JSON.stringify(query.item[field]));
          redisEngine.hset(query.base + '.' + field + '.index', JSON.stringify(query.item[field]), query.item.id);
        }
        query.id = query.item.id;
        query.fields = fields;
        query.score = Number.parseInt(query.item.score);
        delete query.item;
        fetchLinked(query).then(res => {
          for (let i = 0; i < listeners[query.base].sockets.length; i++) {
            query.queryId = listeners[query.base].queries[i].queryId;
            console.log('sending zadd to '+ query.queryId);
            listeners[query.base].sockets[i].emit('newresult', {results: res, query: query, operation: 'insert', timeStamp: new Date()});
          }
        });
        for (let field of fields) {
          listeners[ query.base + ':' + field + ':' + query.id] = {
            sockets: Array.from(listeners[query.base].sockets),
            queries: Array.from(listeners[query.base].queries)
          };
        }
      });

      socket.on('find', query => {
        if (socket.request.user && !socket.request.user.logged_in) return;
        // pub.keys("demo:data:*",(err, keys) => {
        //   keys.map(key => pub.hgetall(key, (err, d) => console.log(d.content)));
        // });
        redisEngine.hgetall(query, (err, d) => {
          socket.emit('results', d);
          let sub = redisdb;
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
