var Primus = require('primus');
var Q = require('q');
module.exports = function (formio) {

  /**
   * The Project class.
   *
   * @param url
   * @constructor
   */
  var Project = function (url) {
    this.project = null;
    this.url = url;
    this.projects = [];
    this.socket = null;
    this.connected = null;
  };

  /**
   * Override the toJson method to return the form.
   * @returns {HTMLElement|*}
   */
  Project.prototype.toJson = function () {
    return this.project;
  };

  /**
   * Create a new project in Form.io
   * @param template
   *   The project template.
   * @returns {*}
   */
  Project.prototype.create = function (project) {
    // Send the request.
    return formio.request('post', formio.config.api + '/project', project).then(function (res) {
      this.project = res.body;
      this.url = formio.config.api + '/project/' + this.project._id.toString();
      return this;
    }.bind(this));
  };

  /**
   * Load a project.
   */
  Project.prototype.load = function () {
    return formio.request('get', this.url).then(function (res) {
      this.project = res.body;
      return this;
    }.bind(this));
  };

  /**
   * Read a project on Form.io
   * @returns {*}
   */
  Project.prototype.read = function (projectId) {
    return formio.request('get', formio.config.api + '/project/' + projectId)
      .then(function (res) {
        this.project = res.body;
        return this;
      }.bind(this));
  };

  /**
   * Update a project in Form.io
   * @param template
   *   The project template.
   * @returns {*}
   */
  Project.prototype.update = function (project) {
    return formio.request('put', formio.config.api + '/project/' + project._id, project)
      .then(function (res) {
        this.project = res.body;
        return this;
      }.bind(this));
  };

  /**
   * Delete a project on Form.io
   * @returns {*}
   */
  Project.prototype.delete = function () {
    return formio.request('delete', this.url).then(function () {
      delete this.project;
    }.bind(this));
  };

  /**
   * Close the socket connection to a project.
   */
  Project.prototype.close = function () {
    this.socket.end();
    this.connected = null;
  };

  /**
   * Connect to a project via websockets.
   *
   * @returns {*|promise}
   */
  Project.prototype.connect = function () {
    if (this.connected) {
      return this.connected.promise;
    }

    this.connected = Q.defer();
    if (
      !formio.currentUser || !formio.currentUser.token || !this.project || !this.project.name
    ) {
      this.connected.reject('User or Project not valid.');
      return this.connected.promise;
    }
    var Socket = Primus.createSocket();
    var socketUrl = formio.config.api.replace(/^http[s]?/, 'ws');
    this.socket = new Socket(socketUrl + '?token=' + formio.currentUser.token + '&project=' + this.project.name);
    this.socket.on('error', function (err) {
      this.socket.end();
      this.connected.reject(err);
    }.bind(this));
    this.socket.on('open', function () {
      this.connected.resolve();
    }.bind(this));
    return this.connected.promise;
  };

  /**
   * Bind to a project via websockets.
   *
   * @param formPath - The Form path to bind to.
   * @param method - The HTTP Method to bind.
   * @param cb - Called when a message has been received.
   * @param sync - If this should be a synchronous bind.
   */
  Project.prototype.bind = function (formPath, method, cb, sync) {
    return this.connect().then(function () {
      return this.form(formPath).then(function (form) {
        var deferred = Q.defer();
        method = method.toUpperCase();
        sync = sync || false;

        var messages = {};

        // Trigger when any data is received within this socket.
        this.socket.on('data', function (data) {

          // If this socket receives an acknowledgement message.
          if (data.type === 'ack') {
            if (data.error) {
              cb(data.error);
              return deferred.reject(data.error);
            }

            if (
              (data.msg) &&
              (data.msg.type === 'bind') &&
              (data.msg.bind.form === form.form._id) &&
              (data.msg.bind.method.toUpperCase() === method)
            ) {
              return deferred.resolve();
            }

            if (
              (data.msg) &&
              (data.msg.type === 'response') &&
              (messages.hasOwnProperty(data.msg.id))
            ) {
              messages[data.msg.id].resolve(data.msg.response);
              delete messages[data.msg.id];
            }
          }

          // If this socket receives a request.
          if (data.type === 'request') {
            cb(null, data.request, function (response) {
              if (sync && response) {
                var message = Q.defer();
                this.socket.write({
                  type: 'response',
                  id: data.id,
                  response: response
                });
                messages[data.id] = message;
                setTimeout(function () {
                  if (messages.hasOwnProperty(data.id)) {
                    messages[data.id].reject('Response Timeout');
                    delete messages[data.id];
                  }
                }, 5000);
                return message.promise;
              }
            }.bind(this));
          }
        }.bind(this));

        // Write the binding request.
        this.socket.write({
          type: 'bind',
          bind: {
            method: method,
            form: form.form._id.toString(),
            sync: sync
          }
        });

        // Return the new promise.
        return deferred.promise;
      }.bind(this));
    }.bind(this));
  };

  /**
   * List all projects on Form.io
   * @returns {*}
   */
  Project.prototype.list = function () {
    return formio.request('get', formio.config.api + '/project').then(function (res) {
      this.projects = res.body;
    }.bind(this));
  };

  /**
   * Export a project
   * @returns {*}
   */
  Project.prototype.export = function () {
    return formio.request('get', this.url + '/export').then(function (res) {
      this.template = res.body;
    }.bind(this));
  };

  /**
   * List all of the forms within a Project.
   */
  Project.prototype.forms = function () {
    return formio.request('get', this.url + '/form');
  };

  /**
   * Return a form within a project by path.
   */
  Project.prototype.form = function (path) {
    return formio.request('get', this.url + '/form?path=' + path).then(function (result) {
      if (!result || !result.body || !result.body.length) {
        return null;
      }

      var form = new formio.Form();
      form.form = result.body[0];
      form.url = this.url + '/form/' + form.form._id.toString();
      return form;
    }.bind(this));
  };

  /**
   * Create a new form within this project.
   *
   * @param form
   * @returns {form}
   */
  Project.prototype.createForm = function (form) {
    var form = new formio.Form(this.url + '/form');
    return form.create(form);
  };

  return Project;
};
