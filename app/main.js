import {h, render} from 'preact';
import App from './App.jsx';

import IO from 'socket.io-client';
let socket = IO.connect('http://localhost:3000');

render(<App socket={socket}/>, document.getElementById('root'));

if (module.hot) {
  require('preact/devtools');
}
