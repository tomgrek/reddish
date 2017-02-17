import React from 'react';
import styles from './App.scss';

export default class App extends React.Component {
  state = {
    data: [{id:'1', content: 'An empty, default item'}]
  }
  constructor(props) {
    super(props);
  }
  componentDidMount() {
    this.props.socket.on('results', (results) => {
      console.log(results);
      if (results === null) return;
      let arr = [];
      // for (let res of Object.keys(results)) {
      //   arr.push(JSON.parse(results[res]));
      // }
      this.setState({data:results});
    });
    this.props.socket.on('newresult', (result) => {
      console.log('new result', result);
      // let results = this.state.data;
      // results.push(result);
      // this.setState({data:results});
      let arr = [];
      // for (let res of Object.keys(result)) {
      //   arr.push(JSON.parse(result[res]));
      // }
      this.setState({data:result.results});
    });
    // query = {base:'articles', id:'1', fields:['titles', 'tags'], min: 0, max: '+inf', offset: 1, count: '2'}

    console.log('emitting');
    //setTimeout(()=>this.props.socket.emit('find', "demo:data"),2000);
    //this.props.socket.emit('find', "articles");
    // this.props.socket.emit('fetchLinked', JSON.stringify({
    //   base: 'articles',
    //   id: 1,
    //   fields: ['titles', 'tags'],
    //   queryId: 123, // put there by us, it'll be returned to us to id the query quickly
    //   dontSendWholeSetOnUpdate: true
    // }));
    this.props.socket.emit('fetchNLinked', JSON.stringify({
      base: 'articles',
      fields: ['titles', 'tags'],
      min: 0,
      max: '+inf',
      offset: 0,
      count: -1,
      dontSendWholeSetOnUpdate: false,
      myIdentifier: new Date()
    }));

    let newDataItem = {
      id: 7,
      rank: 99, // or date
      titles: 'A crime was committed',
      tags: ['tag1', 'tag2']
    };
    // setTimeout(() => {
    //   this.props.socket.emit('insert', JSON.stringify({
    //     base: 'articles',
    //     item: newDataItem,
    //     dontNotifyUpdates: false
    //   }));
    // }, 5000);
  }

  render() {
    let divStyle = {
      height: '2em',
      lineHeight: '2em',
      border: '1px solid black',
    };
    let todos = this.state.data.map(item => (
      <li style={divStyle} key={item.id}>{item.titles}</li>
      )
    );
    let navbar = () => {
      const loginForm = (
        <form action="/login" method="post" style={{display:'inline-block', float:'right'}}>
          <span>
            <label>Username:</label>
            <input
              type="text"
              name="username"
              style={{border:'1px solid black'}}/>
          </span>
          <span>
            <label>Password:</label>
            <input
              type="password"
              name="password"
              style={{border:'1px solid black'}}/>
          </span>
          <span>
            <input
              type="submit"
              value="Log In"
              style={{backgroundColor:'aliceblue'}}/>
          </span>
        </form>
      );
      const navbarStyle = {
        backgroundColor: 'black',
        display: 'block',
        color: 'white'
      };
      let loggedIn = () => {
        let cookies = document.cookie.split('=');
        if (cookies.indexOf('loggedin') === -1) return false;
        return cookies[cookies.indexOf('loggedin')+1];
      };

      return (
        <navbar style={navbarStyle}>
          <h1 style={{display:'inline-block'}}>Live List</h1>
          {loggedIn() ? <span style={{float:'right'}}>{loggedIn()}, LOGOUT</span> : loginForm}
        </navbar>
      );
    };
    return (
      <div id="app">
        {navbar()}
        <ul>
          {todos}
        </ul>
        <div style={{height:'50vh'}}>

        </div>
      </div>
    );
  }
}
