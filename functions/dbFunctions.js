const fetchLinked = function(query, db) {
  let retVal = query.score ? { score: query.score } : {};
  retVal.id = query.id;
  let promises = [];
  return new Promise((res, rej) => {
    for (var field of query.fields) {
      promises.push(new Promise((resolve, reject) => {
        db.get(query.base + ':' + field + ':' + query.id, (err, data) => {
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
    }).catch(reason => {
      rej(reason);
    });
  });
};

const findOne = function(query, db) {
  return new Promise((resolve, reject) => {
    db.hget(query.base + '.' + query.searchField + '.index', query.match, (err, data) => {
      if (err) reject(err);
      else {
        query.id = data;
        fetchLinked(query, db).then(v => {
          resolve(v);
        });
      }
    });
  });
}

const setUnion = function(a, b) {
  y = new Set(b);
  return [...new Set(a.filter(v => y.has(v)))][0];
};

module.exports = {
  fetchLinked: fetchLinked,
  findOne: findOne,
  setUnion: setUnion
};
