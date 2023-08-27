import { t } from "i18next";

class Users {
  constructor(bot, orbitdb) {
    this.bot = bot;
    this.orbitdb = orbitdb;
  }

  addAction(action) {
    
    this._actions[name] = action;
  }

  get(name) {
    return this._actions[name];
  }
}

export default Users;