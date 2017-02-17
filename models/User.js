const bcrypt = require('bcrypt');
const dbFunctions = require('../functions/dbFunctions.js');

class User {
  constructor(id, username, password) {
    this.id = id;
    this.username = username;
    this.password = password;
  }
  generateHash(password) {
    return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
  }
  validPassword(password) {
    return password === this.password;
    //   return bcrypt.compareSync(password, this.password);
  }
}

User.findById = function(id, cb, db) {
  dbFunctions.fetchLinked({base: 'users', id: id, fields: ['username', 'password']}, db).then(user => {
    if (!user) {
      cb("No user found", null);
    } else {
      cb(null, user);
    }
  });
}
User.findOne = function(fieldMatch, cb, db) {
  let key = Object.keys(fieldMatch)[0];
  let value = fieldMatch[key];
  query = {base: 'users', searchField: key, match: value, fields: ['username', 'password']};
  dbFunctions.findOne(query, db).then(user => {
    cb(null, new User(user.id, user.username, user.password));
  });
}

module.exports = User;
