import {h, Component} from 'preact';
import styles from './App.scss';
import Reddish from './reddish.js';

export default class App extends Component {
  state = {
    data: [{id:'1', content: 'An empty, default item'}],
    todosList: new Reddish(this.props.socket, 'articles')
  }
  constructor(props) {
    super(props);
  }
  componentDidMount() {
    this.state.todosList.link(this, ['titles', 'tags'], 'data');
    // setTimeout(()=> {
    //   this.state.todosList.insert({
    //     titles: 'Todo item 5',
    //     tags: ['mumbo', '2']
    //   }, 106);
    // }, 3000);
    //setTimeout(()=>this.props.socket.emit('find', "demo:data"),2000);
    //this.props.socket.emit('find', "articles");
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
      if (!this.state.todosList.ready) return (
        <div>LOADING</div>
        );
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
