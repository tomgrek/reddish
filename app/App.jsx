import {h, Component} from 'preact';

const Link = ({ children, ...props }) => (
    <a {...props}>{ children }</a>
);

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
    //setTimeout(()=>this.props.socket.emit('find', "demo:data"),2000);
    //this.props.socket.emit('find', "articles");
  }

  render() {
    let listStyle = {
      width: '66%',
      marginLeft: 'auto',
      marginRight: 'auto',
      marginTop: '1.5em'
    };
    let itemStyle = {
      height: '2em',
      lineHeight: '2em',
      border: '1px dashed gray',
      marginBottom: '0.5em',
      padding: '0.5em 0.5em'
    };
    const deleteClicked = (evt, id) => {
      console.log(evt, id);
    }
    let todos = this.state.data.map(item => (
      <li style={itemStyle} key={item.id}>
        {item.titles}
        <span style={{marginLeft: '2em'}} onClick={deleteClicked.bind(this, item.id)}><Link href="#">(delete)</Link></span>
        <span style={{marginLeft: '1em'}}><Link href="#">(edit)</Link></span>
      </li>
      )
    );
    let navbar = () => {
      const loginForm = (
        <form action="/login" method="post" style={{lineHeight: '4em', display:'inline-block', float:'right'}}>
          <span style={{marginRight: '1em'}}>
            <label>Username:</label>
            <input
              type="text"
              name="username"
              style={{border:'1px solid white', marginLeft: '0.4em', backgroundColor: 'gray'}}/>
          </span>
          <span style={{marginRight: '1em'}}>
            <label>Password:</label>
            <input
              type="password"
              name="password"
              style={{border:'1px solid white', marginLeft: '0.4em', backgroundColor: 'gray'}}/>
          </span>
          <span>
            <input
              type="submit"
              value="Log In"
              style={{backgroundColor:'gray', padding:'0.66em 1em'}}/>
          </span>
        </form>
      );
      const navbarStyle = {
        backgroundColor: 'black',
        display: 'block',
        color: 'white',
        height: '4em',
        padding: '0.5em 0.5em'
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
          <h1 style={{display:'inline-block', fontSize: '1.75em', lineHeight: '2.25em'}}>Reddish: ToDo List Demo</h1>
          {loggedIn() ? <span style={{float:'right'}}>{loggedIn()}, LOGOUT</span> : loginForm}
        </navbar>
      );
    };

    const addItemClicked = (evt) => {
      this.state.todosList.insert({
        titles: document.getElementById('itemToAdd').value,
        tags: ['not','really']
      });
    };

    return (
      <div id="app">
        {navbar()}
        <div style={listStyle}>
          <ul>
            {todos}
          </ul>
        </div>
        <div style={{margin: '2em 2em'}}>
          <input style={{width:'50%', border:'1px solid black', fontSize: '2em', padding: '0 0.5em', backgroundColor: '#ddd', color: 'black'}} type="text" name="itemToAdd" id="itemToAdd" placeholder="Item title"></input>
          <button id="addItem" onClick={addItemClicked} style={{marginLeft: '1em', fontSize: '2em', padding: '0 1em', backgroundColor: 'gray'}}>Add Item</button>
        </div>
      </div>
    );
  }
}
