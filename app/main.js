import React from 'react';
import ReactDOM from 'react-dom';
import App from './App.jsx';

import IO from 'socket.io-client';
let socket = IO.connect('http://localhost:3000');

ReactDOM.render(<App socket={socket}/>, document.getElementById('root'));
