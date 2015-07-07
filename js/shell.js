/* ------------------------------------------------------------------------*
 * Copyright 2013-2014 Arne F. Claassen
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *-------------------------------------------------------------------------*/

var Josh = Josh || {};
(function(root, $, _) {
  Josh.Shell = function(config) {
    config = config || {};

    // instance fields
    var _console = config.console || (Josh.Debug && root.console ? root.console : {
      log: function() {}
    });
    /**
     * Value of the prompt
     * @property _prompt
     * @type {String}
     * @default 'jsh$'
     * @private
     */
    var _prompt = config.prompt || 'jsh$';
    /**
     * ID where the view is located
     * @property _shell_view
     * @type {String}
     * @default 'shell-view'
     * @private
     */
    var _shell_view = config.shell_view_id || 'shell-view';
    /**
     * @property _shell_cli
     * @type {String}
     * @default 'shell-cli'
     * @private
     */
    var _shell_cli = config.input_id || 'shell-cli';
    /**
     * @property _blinktime
     * @type {Number}
     * @default 500
     * @private
     */
    var _blinktime = config.blinktime || 500;
    /**
     * @property _history
     * @type {Josh.History}
     * @default new Josh.History()
     * @private
     */
    var _history = config.history || new Josh.History();
    /**
     * @property _readline
     * @type {Josh.ReadLine}
     * @default new Josh.ReadLine()
     * @private
     */
    var _readline = config.readline || new Josh.ReadLine({
      history: _history,
      console: _console
    });
    /**
     * @property _active
     * @type {Boolean}
     * @default false
     * @private
     */
    var _active = false;
    /**
     * @property _cursor_visible
     * @type {Boolean}
     * @default false
     * @private
     */
    var _cursor_visible = false;

    var _activationHandler;
    var _deactivationHandler;
    var _cmdHandlers = {
      clear: {
        exec: function(cmd, args, callback) {
          _elements.cli.parent().empty();
          callback();
        }
      },
      help: {
        exec: function(cmd, args, callback) {
          callback(self.templates.help({
            commands: commands()
          }));
        }
      },
      history: {
        exec: function(cmd, args, callback) {
          if (args[0] == "-c") {
            _history.clear();
            callback();
            return;
          }
          callback(self.templates.history({
            items: _history.items()
          }));
        }
      },
      _default: {
        exec: function(cmd, args, callback) {
          callback(self.templates.bad_command({
            cmd: cmd
          }));
        },
        completion: function(cmd, arg, line, callback) {
          if (!arg) {
            arg = cmd;
          }
          return callback(self.bestMatch(arg, self.commands()));
        }
      }
    };
    var _line = {
        text: '',
        cursor: 0
      },
      _searchMatch = '',
      _view, _panel,
      _promptHandler,
      _initializationHandler,
      _initialized,
      _elements = {};

    // public methods
    var self = {
      /**
       * Holds the shell-panel element
       * @property $el
       * @type {jQuery Element}
       * @default null
       */
      $el: null,
      /**
       * @property commands
       * @type {Object}
       * @default [Object with default commands]
       */
      commands: commands,
      /**
       * Hash of Templates
       * @property templates
       * @type {Object}
       */
      templates: {
        history: _.template("<div><% _.each(items, function(cmd, i) { %><div><%- i %>&nbsp;<%- cmd %></div><% }); %></div>"),
        help: _.template("<div><div><strong>Commands:</strong></div><% _.each(commands, function(cmd) { %><div>&nbsp;<%- cmd %></div><% }); %></div>"),
        bad_command: _.template('<div><strong>Unrecognized command:&nbsp;</strong><%=cmd%></div>'),
        input_cmd: _.template('<div class="shell-cli"><span class="prompt"></span>&nbsp;<span class="input"><span class="left"/><span class="cursor"/><span class="right"/></span></div>'),
        input_search: _.template('<div class="shell-cli">(reverse-i-search)`<span class="searchterm"></span>\':&nbsp;<span class="input"><span class="left"/><span class="cursor"/><span class="right"/></span></div>'),
        suggest: _.template("<div><% _.each(suggestions, function(suggestion) { %><div><%- suggestion %></div><% }); %></div>")
      },
      /**
       * Check if readline is active
       * @method isActive
       * @return {Boolean}
       */
      isActive: function() {
        return _readline.isActive();
      },
      /**
       * Activates the readline
       * @method activate
       */
      activate: function() {
        if (_elements.view.length === 0) {
          _active = false;
          return;
        }
        _readline.activate();
      },
      /**
       * Deactivates the readline
       * @method deactivate
       */
      deactivate: function() {
        _console.log("deactivating");
        _active = false;
        _readline.deactivate();
      },
      /**
       * Sets the shell-panel element, and attaches it to the readline
       * @method setElement
       * @param  {jQuery Element} $el shell-panel element
       */
      setElement: function($el) {
        self.$el = $el;
        // Set child elements
        _elements.cli = null;
        _elements.view = $('<div class="shell-view"></div>');
        self.$el.append(_elements.view);

        console.log($el);
        // attach readline to the shell panel
        _readline.attach($el[0]);
        $el.focus();
      },
      /**
       * Adds a Command Handler into the cmdHandlers Hash
       * @method setCommandHandler
       * @param  {String} cmd Name of new command
       * @param  {Object} cmdHandler Object with it's behaviour
       */
      setCommandHandler: function(cmd, cmdHandler) {
        _cmdHandlers[cmd] = cmdHandler;
      },
      /**
       * Returns the desired command
       * @method getCommandHandler
       * @param  {String} cmd Name of command
       * @return {Object} Command's behaviour
       */
      getCommandHandler: function(cmd) {
        return _cmdHandlers[cmd];
      },
      /**
       * Changes the prompt
       * @method setPrompt
       * @param  {[type]} prompt [description]
       */
      setPrompt: function(prompt) {
        _prompt = prompt;
        if (!_active) {
          return;
        }
        self.refresh();
      },
      /**
       * @event EOT
       * @method onEOT
       * @param  {Function} completionHandler
       */
      onEOT: function(completionHandler) {
        _readline.onEOT(completionHandler);
      },
      /**
       * @event cancel
       * @method onCancel
       * @param  {Function} completionHandler
       */
      onCancel: function(completionHandler) {
        _readline.onCancel(completionHandler);
      },
      /**
       * @event initialize
       * @method onInitialize
       * @param  {Function} completionHandler
       */
      onInitialize: function(completionHandler) {
        _initializationHandler = completionHandler;
      },
      /**
       * @event activate
       * @method onActivate
       * @param  {Function} completionHandler
       */
      onActivate: function(completionHandler) {
        _activationHandler = completionHandler;
      },
      /**
       * @event deactivate
       * @method onDeactivate
       * @param  {Function} completionHandler
       */
      onDeactivate: function(completionHandler) {
        _deactivationHandler = completionHandler;
      },
      /**
       * @event newPrompt
       * @method onNewPrompt
       * @param  {Function} completionHandler
       */
      onNewPrompt: function(completionHandler) {
        _promptHandler = completionHandler;
      },
      /**
       * Render the terminal
       * @method render
       */
      render: function() {
        var text = _line.text || '';
        var cursorIdx = _line.cursor || 0;
        if (_searchMatch) {
          cursorIdx = _searchMatch.cursoridx || 0;
          text = _searchMatch.text || '';
          _elements.cli.find('.searchterm').text(_searchMatch.term);
        }
        var left = _.escape(text.substr(0, cursorIdx)).replace(/ /g, '&nbsp;');
        var cursor = text.substr(cursorIdx, 1);
        var right = _.escape(text.substr(cursorIdx + 1)).replace(/ /g, '&nbsp;');
        _elements.cli_prompt.html(_prompt);
        _elements.cli_left.html(left);
        if (!cursor) {
          _elements.cli_cursor.html('&nbsp;').css('textDecoration', 'underline');
        } else {
          _elements.cli_cursor.text(cursor).css('textDecoration', 'underline');
        }
        _elements.cli_right.html(right);
        _cursor_visible = true;
        self.scrollToBottom();
        _console.log('rendered "' + text + '" w/ cursor at ' + cursorIdx);
      },
      /**
       * Refresh the input
       * @method refresh
       * @return {[type]} [description]
       */
      refresh: function() {
        //setCliView(null, true);
        self.render();
        _console.log('refreshed shell-cli');
      },
      /**
       * @method scrollToBottom
       */
      scrollToBottom: function() {
        _panel.animate({
          scrollTop: _view.height()
        }, 0);
      },
      /**
       * Checks the best possible match
       * @method bestMatch
       * @param  {String} partial Partial text
       * @param  {Array} possible Possible options to search for
       * @return {Object} Object with suggestions and/or completion
       */
      bestMatch: function(partial, possible) {
        _console.log("bestMatch on partial '" + partial + "'");
        var result = {
          completion: null,
          suggestions: []
        };
        if (!possible || possible.length === 0) {
          return result;
        }
        var common = '';
        if (!partial) {
          if (possible.length == 1) {
            result.completion = possible[0];
            result.suggestions = possible;
            return result;
          }
          if (!_.every(possible, function(x) {
              return possible[0][0] == x[0];
            })) {
            result.suggestions = possible;
            return result;
          }
        }
        for (var i = 0; i < possible.length; i++) {
          var option = possible[i];
          if (option.slice(0, partial.length) == partial) {
            result.suggestions.push(option);
            if (!common) {
              common = option;
              _console.log("initial common:" + common);
            } else if (option.slice(0, common.length) != common) {
              _console.log("find common stem for '" + common + "' and '" + option + "'");
              var j = partial.length;
              while (j < common.length && j < option.length) {
                if (common[j] != option[j]) {
                  common = common.substr(0, j);
                  break;
                }
                j++;
              }
            }
          }
        }
        result.completion = common.substr(partial.length);
        return result;
      }
    };

    /**
     * Appends # to the ID
     * @method id
     * @param  {String} _id
     * @return {String} # + id
     * @private
     */
    function id(_id) {
      return "#" + _id;
    }

    /**
     * Lists all the command names
     * @method commands
     * @return {Array} Array of command names
     * @private
     */
    function commands() {
      return _.chain(_cmdHandlers).keys().filter(function(x) {
        return x[0] != "_";
      }).value();
    }

    var _blinking = false;
    /**
     * Makes the cursor blink
     * @method blinkCursor
     * @private
     */
    function blinkCursor() {
      if (!_active || _blinking) {
        return;
      }

      var blink = function() {
        if (!_active) {
          clearInterval(_blinking);
          _blinking = false;
          return;
        }
        _blinking = true;
        _cursor_visible = !_cursor_visible;

        if (_cursor_visible) {
          _elements.cli_cursor.css('textDecoration', 'underline');
        } else {
          _elements.cli_cursor.css('textDecoration', '');
        }
      };

      _blinking = root.setInterval(blink, _blinktime);
    }

    /**
     * Splits a sentence (with spaces) into an array of words
     * @method split
     * @param  {String} str
     * @return {Array of Strings}
     * @private
     */
    function split(str) {
      return _.filter(str.split(/\s+/), function(x) {
        return x;
      });
    }

    /**
     * 
     * @method getHandler
     * @param  {String} cmd
     * @return {Object} Command Handler
     * @private
     */
    function getHandler(cmd) {
      return _cmdHandlers[cmd] || _cmdHandlers._default;
    }

    /**
     * @method renderOutput
     * @param  {String} output [nullable]
     * @param  {Function} callback
     * @return {Any} Callback response
     * @private
     */
    function renderOutput(output, callback) {
      if (output) {
        _elements.cli.after(output);
      }
      _elements.cli_cursor.css('textDecoration', '');
      setCliView();
      if (_promptHandler) {
        return _promptHandler(function(prompt) {
          self.setPrompt(prompt);
          return callback();
        });
      }
      return callback();
    }

    /**
     * Sets the cli, and appends it to the view
     * @method setCliView
     * @param  {String} _template Optional template name. Default 'input_cmd'
     */
    function setCliView(_template) {
      var template = _template || 'input_cmd';
      _elements.cli = $(self.templates[template]());

      // Elements cache
      _elements.cli_prompt = _elements.cli.find('.prompt');
      _elements.cli_cursor = _elements.cli.find('.input .cursor');
      _elements.cli_left = _elements.cli.find('.input .left');
      _elements.cli_right = _elements.cli.find('.input .right');
      // Append template to element
      _elements.view.append(_elements.cli);
    }

    /**
     * Activates shell
     * @method activate
     * @private
     */
    function activate() {
      _console.log("activating shell");
      if (!_view) {
        _view = _elements.view;
      }
      if (!_panel) {
        _panel = self.$el;
      }
      if (!_elements.cli) {
        setCliView();
      }
      self.refresh();
      _active = true;
      blinkCursor();
      if (_promptHandler) {
        _promptHandler(function(prompt) {
          self.setPrompt(prompt);
        });
      }
      if (_activationHandler) {
        _activationHandler();
      }
    }

    // init
    _readline.onActivate(function() {
      if (!_initialized) {
        _initialized = true;
        if (_initializationHandler) {
          return _initializationHandler(activate);
        }
        return activate();
      }
    });
    _readline.onDeactivate(function() {
      if (_deactivationHandler) {
        _deactivationHandler();
      }
    });
    _readline.onChange(function(line) {
      _line = line;
      self.render();
    });
    _readline.onClear(function() {
      _cmdHandlers.clear.exec(null, null, function() {
        renderOutput(null, function() {});
      });
    });
    _readline.onSearchStart(function() {
      setCliView('input_search');
      _console.log('started search');
    });
    _readline.onSearchEnd(function() {
      setCliView();
      _searchMatch = null;
      self.render();
      _console.log("ended search");
    });
    _readline.onSearchChange(function(match) {
      _searchMatch = match;
      self.render();
    });
    _readline.onEnter(function(cmdtext, callback) {
      _console.log("got command: " + cmdtext);
      var parts = split(cmdtext);
      var cmd = parts[0];
      var args = parts.slice(1);
      var handler = getHandler(cmd);
      return handler.exec(cmd, args, function(output, cmdtext) {
        renderOutput(output, function() {
          callback(cmdtext);
        });
      });
    });
    _readline.onCompletion(function(line, callback) {
      if (!line) {
        return callback();
      }
      var text = line.text.substr(0, line.cursor);
      var parts = split(text);

      var cmd = parts.shift() || '';
      var arg = parts.pop() || '';
      _console.log("getting completion handler for " + cmd);
      var handler = getHandler(cmd);
      if (handler != _cmdHandlers._default && cmd && cmd == text) {

        _console.log("valid cmd, no args: append space");
        // the text to complete is just a valid command, append a space
        return callback(' ');
      }
      if (!handler.completion) {
        // handler has no completion function, so we can't complete
        return callback();
      }
      _console.log("calling completion handler for " + cmd);
      return handler.completion(cmd, arg, line, function(match) {
        _console.log("completion: " + JSON.stringify(match));
        if (!match) {
          return callback();
        }
        if (match.suggestions && match.suggestions.length > 1) {
          return renderOutput(self.templates.suggest({
            suggestions: match.suggestions
          }), function() {
            callback(match.completion);
          });
        }
        return callback(match.completion);
      });
    });
    return self;
  };
})(this, $, _);