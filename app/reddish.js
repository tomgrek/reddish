export default class Reddish {
  constructor(socket, baseSchemaName) {
    this.socket = socket;
    this.baseSchemaName = baseSchemaName;
    this.uniqueQueryId = (new Date()).toISOString();
    this._cache = [];
  }
  link(component, fields, stateDataItemName, minScore = 0, maxScore = '+inf', offset = 0, count = -1) {
    this.ready = false;
    this.socket.emit('fetchNLinked', JSON.stringify({
      base: this.baseSchemaName,
      fields: fields,
      min: minScore,
      max: maxScore,
      offset: offset,
      count: count,
      dontSendWholeSetOnUpdate: true,
      queryId: this.uniqueQueryId
    }));
    this.socket.on('newresult', (result) => {
      console.log(result);
      if (result.query.base !== this.baseSchemaName) return;
      if (result.query.queryId !== this.uniqueQueryId) return;
      this._cache.map(item => {
        if (item.id === result.results.id) {
          item[result.field] = result.results[result.field];
        }
      });
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
}
