export default class Reddish {
  constructor(socket, baseSchemaName) {
    this.socket = socket;
    this.baseSchemaName = baseSchemaName;
    this.uniqueQueryId = (new Date()).toISOString();
    this._cache = [];
    this._linkedComponent = 0;
  }
  insertWithScore(newItem) {
    let insertPoint = -1;
    for (let i = 0; i < this._cache.length; i++) {
      if (this._cache[i].score > newItem.score) {
        insertPoint = i;
        break;
      }
    }
    if (insertPoint === -1) {
      this._cache.push(newItem);
    } else {
      this._cache = this._cache.slice(0, insertPoint).concat(newItem).concat(this._cache.slice(insertPoint));
    }
  }
  link(component, fields, stateDataItemName, minScore = 0, maxScore = '+inf', offset = 0, count = -1) {
    this.ready = false;

    //TODO: check offline status here, if so, load the data from localStorage instead
    // and obv store the data in localstorage upon fetch.

    this._linkedComponent = component; // save ref to component for insert etc.
    this.socket.emit('fetchNLinked', {
      base: this.baseSchemaName,
      fields: fields,
      min: minScore,
      max: maxScore,
      offset: offset,
      count: count,
      dontSendWholeSetOnUpdate: true,
      queryId: this.uniqueQueryId
    });
    this.socket.on('newresult', (result) => {
      console.log(result, result.query.base,result.query.queryId, this.uniqueQueryId);
      if (result.query.base !== this.baseSchemaName) return;
      if (result.query.queryId !== this.uniqueQueryId) return;
      if (result.operation === 'insert') {
        console.log('insert op');
        this.insertWithScore(result.results);
      } else {
        this._cache.map(item => {
          if (item.id === result.results.id) {
            item[result.field] = result.results[result.field];
          }
        });
      }
      let stateChange = {};
      stateChange[stateDataItemName] = this._cache;
      component.setState(stateChange);
    });
    this.socket.on('results', (results) => {
      this.ready = true;
      if (results.query.base !== this.baseSchemaName) return;
      if (results.query.queryId !== this.uniqueQueryId) return;
      if (results === null) return;
      let stateChange = {};
      stateChange[stateDataItemName] = results.result;
      component.setState(stateChange);
      this._cache = Array.from(results.result);
    });
  }
  insert(item, score = (new Date()).getTime(), id) {
    let finalItem = Object.assign({}, item, {score: score, id: id});
    this.socket.emit('insert', {
      base: this.baseSchemaName,
      item: finalItem,
      queryId: this.uniqueQueryId,
      dontNotifyUpdates: false
    });
    // could update the _cache here for 'optimistic UI'
  }
}
