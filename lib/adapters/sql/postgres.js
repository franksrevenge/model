var utils = require('utilities')
  , pg
  , generator = require('../../../lib/generators/sql')
  , model = require('../../index')
  , Query = require('../../query/query').Query
  , BaseAdapter = require('./base').Adapter
  , Adapter
  , _baseConfig;

// DB lib should be locally installed in the consuming app
pg = utils.file.requireLocal('pg', model.localRequireError);

_baseConfig = {
  user: process.env.USER
, database: process.env.USER
, password: null
, host: null
, port: 5432
, autoincrement: false
, poolSize: 20
, poolIdleTimeout : 30000
, debug: false
};

Adapter = function (options) {
  var opts = options || {}
    , config;

  this.name = 'postgres';
  this.type = 'sql';
  this.config = _baseConfig;
  this.client = null;
  this.generator = generator.getGeneratorForAdapter(this);
  this.queryCount = 0;

  utils.mixin(this.config, opts);

  this.init.apply(this, arguments);
};

Adapter.prototype = new BaseAdapter();
Adapter.prototype.constructor = Adapter;

utils.mixin(Adapter.prototype, new (function () {

  this.init = function () {
    pg.defaults.poolSize = this.config.poolSize;
    pg.defaults.poolIdleTimeout = this.config.poolIdleTimeout;
    this.client = new pg.Client(this.config);
    this.debug = this.config.debug || false;
  };

  this.connect = function (callback) {
    var self = this
      , cb = callback || function () {};
    this.client.connect(function (err, data) {
      if (err) {
        self.emit('error', err);
        cb(err);
      }
      else {
        self.emit('connect');
        cb();
      }
    });
  };

  this.disconnect = function (callback) {
    var self = this
      , cb = callback || function () {};
    this.client.end(function (err, data) {
      if (err) {
        self.emit('error', err);
        cb(err);
      }
      else {
        self.emit('disconnect');
        cb();
      }
    });
  };


  this.getPreferredClient = function( preferredClient, callback ) {
    if(preferredClient) {
      callback(null, { client: preferredClient } );
    }
    else if (this.config.poolSize) {
      pg.connect(this.config, function(err, pooledClient, done) {
        if(err) {
          callback(err, null);
        }
        else {
          callback(null, { client: pooledClient, doneFunction: done } );
        }
      });
    }
    else {
      callback(null, { client: this.client } );
    }
  };


  this.exec = function (query, preferredClient, callback ) {
    if (model.log) {
      model.log(query);
    }

	var	adapter	= this,
    	client	= preferredClient;

	adapter.queryCount++;

	var queryCount = adapter.queryCount;


    if (!client) {
     if (this.config.poolSize) {
        pg.connect(this.config, function(err, pooledClient, done) {
          if(err) {
            callback(err, null);
          }
          else {
			if(adapter.debug) {
				console.info('DB > Query #' + queryCount + ' [' + ( pooledClient.__transactionId || '' ) + ']: ' + query);
			}

            pooledClient.query(query, function(err, result) {
              done();

              if((err) && (adapter.debug)) {
              	console.error('DB < Fail #' + queryCount + ' [' + ( pooledClient.__transactionId || '' ) + ']: ' + err.message);
			  }
			  else if(adapter.debug) {
			    console.info('DB < Ok #' + queryCount + ' [' + ( pooledClient.__transactionId || '' ) + ']: ' + result.rowCount + ' rows');
			  }
              callback(err,result);
            });
          }
        });

        return;
      }
      else {
        client = this.client;
      }
    }


    if(adapter.debug) {
    	console.info('DB > Query #' + queryCount + ' [' + ( client.__transactionId || '' ) + ']: ' + query);
	}

    return client.query(query, function(err, result) {
	  if((err) && (adapter.debug)) {
		console.error('DB < Fail #' + queryCount + ' [' + ( client.__transactionId || '' ) + ']: ' + err.message);
	  }
	  else if(adapter.debug) {
	    console.info('DB < Ok #' + queryCount + ' [' + ( client.__transactionId || '' ) + ']: ' + result.rowCount + ' rows');
	  }

      callback(err, result);
	});
    // return this.client.query(query, callback);
  };


  this.load = function (query, callback) {
    var self = this
      , sql = ''
      , cb
      , processor;

    // Package up SQL-specific data in the query object
    query._sqlMetadata = this._getSqlMetadata(query);

    sql = this._createSelectStatementWithConditions(query);

    if (query.opts.count) {
      this.exec(sql, query.opts.preferredAdapterClient, function (err, data) {
        if (err) {
          callback(err, null);
        }
        else {
          callback(null, data.rows[0].count);
        }
      });
    }
    else {
      if (callback) {
        cb = function (err, res) {
          // If explicitly limited to one, just return the single instance
          // This is also used by the `first` method
          if (res && query.opts.limit == 1) {
            res = res[0];
          }
          callback(null, res);
        };
      }
      processor = new BaseAdapter.EventedQueryProcessor(query, cb);

      self.getPreferredClient(query.opts.preferredAdapterClient, function(err, clientData) {
        if (err) {
          callback(err, null);
        }
        else {
          setTimeout(function () {
            processor.process(self.exec(sql, clientData.client, function() { if( clientData.doneFunction ) { clientData.doneFunction(); } }));
          }, 0);
        }
      });

      return processor;
    }

  };

  this.bySQL = function (query, model, callback) {
    var name = this._tableizeModelNameFull(model.modelName)
      , sql = 'SELECT ' + name + '.* FROM ' + name;
    sql += ' ' + query;
    this._itemsWithSQL.apply(sql, [name], name, query, callback);
  };

  this.update = function (data, query, callback) {
    var sql = this._createUpdateStatementWithConditions(data, query);
    this.exec(sql, query.opts.preferredAdapterClient, function (err, res) {
      if (err) {
        callback(err, null);
      }
      else {
        if (data instanceof model.ModelBase) {
          callback(null, data);
        }
        else {
          callback(null, true);
        }
      }
    });
  };

  this.remove = function (query, callback) {
    var sql = this._createDeleteStatementWithConditions(query);
    this.exec(sql, query.opts.preferredAdapterClient, function (err, data) {
      if (err) {
        callback(err, null);
      }
      else {
        callback(null, true);
      }
    });
  };

  this.insert = function (data, opts, callback) {
    var self = this
      , items = Array.isArray(data) ? data : [data]
      , modelName = items[0].type
      , ctor = model[modelName]
      , reg = model.descriptionRegistry
      , props = reg[modelName].properties
      , sql = ''
      , autoincrement = this.config.autoincrement;

   items.forEach(function (item) {
      var statement = self._createInsertStatement(item, props, autoincrement);
      statement = statement.replace(/;$/, ' RETURNING id;');
      sql += statement;
    });

    this.exec(sql, opts.preferredAdapterClient, function (err, res) {
      var item
        , rows;
      if (err) {
        callback(err, null);
      }
      else {
        rows = res.rows;
        for (var i = 0, ii = items.length; i < ii; i++) {
          item = items[i];
          item.id = rows[i].id; // Set the id from the row
          item._saved = true;
        }
        if (data instanceof model.ModelBase) {
          callback(null, data);
        }
        else {
          callback(null, true);
        }
      }
    });
  };

  this.createTable = function (names, callback) {
    var sql = this.generator.createTable(names);
    this.exec(sql, null, callback);
  };

  this.dropTable = function (names, callback) {
    var sql = this.generator.dropTable(names);
    this.exec(sql, null, callback);
  };

})());

module.exports.Adapter = Adapter;
