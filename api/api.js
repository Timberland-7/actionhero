////////////////////////////////////////////////////////////////////////////
// DAVE API Framweork in node.js
// Evan Tahler @ Fall 2011

////////////////////////////////////////////////////////////////////////////
// Init
function initRequires(api)
{
	api.utils = require("./utils.js").utils;
	api.log = require("./logger.js").log;
	api.tasks = require("./tasks.js").tasks;
	api.cache = require("./cache.js").cache;
	for(var task in api.tasks){if (task != "Task"){api.log("task loaded: "+task)}}
	api.build_response = require("./response.js").build_response; 

	api.app.listen(api.configData.serverPort);
}

////////////////////////////////////////////////////////////////////////////
// Init logging folder
function initLogFolder(api)
{
	try { api.fs.mkdirSync(api.configData.logFolder, "777") } catch(e) {}; 
}

////////////////////////////////////////////////////////////////////////////
// DB setup
function initDB(api)
{
	api.dbObj = new api.SequelizeBase(api.configData.database.database, api.configData.database.username, api.configData.database.password, {
		host: api.configData.database.host,
		port: api.configData.database.port,
		logging: api.configData.database.consoleLogging
	});

	api.models = {};
	api.modelsArray = [];
	api.fs.readdirSync("./models").forEach( function(file) {
		var modelName = file.split(".")[0];
		api.models[modelName] = require("./models/" + file)['defineModel'](api);
		api.modelsArray.push(modelName); 
		api.log("model loaded: " + modelName);
	});
	api.dbObj.sync().on('success', function() {
		api.log("DB conneciton sucessfull and Objects mapped to DB tables");
	}).on('failure', function(error) {
		api.log("trouble synchronizing models and DB.  Correct DB credentials?");
		api.log(JSON.stringify(error));
		api.log("exiting");
		process.exit(1);
	})
}

////////////////////////////////////////////////////////////////////////////
// postVariable config and load
function initPostVariables(api)
{
	api.postVariables = api.configData.postVariables || [];
	for(var model in api.models){
		for(var attr in api.models[model].rawAttributes){
			api.postVariables.push(attr);
		}
	}
}

////////////////////////////////////////////////////////////////////////////
// populate actions
function initActions(api)
{
	api.actions = {};
	api.actionsArray = [];
	api.fs.readdirSync("./actions").forEach( function(file) {
		var actionName = file.split(".")[0];
		api.actions[actionName] = require("./actions/" + file)[actionName];
		api.actionsArray.push(actionName);
		api.log("action loaded: " + actionName);
	});
}

////////////////////////////////////////////////////////////////////////////
// Periodic Tasks (fixed timer events)
function initCron(api)
{
	if (api.configData.cronProcess)
	{
		api.processCron = require("./cron.js").processCron;
		api.cronTimer = setTimeout(api.processCron, api.configData.cronTimeInterval, api);
		api.log("periodic (internal cron) interval set to process evey " + api.configData.cronTimeInterval + "ms");
	}
}

////////////////////////////////////////////////////////////////////////////
// Request Processing
function initListen(api)
{
	api.app.all('/*', function(req, res, next){
		api.timer = {};
		api.timer.startTime = new Date().getTime();
		api.req = req;
		api.res = res;
		api.response = {}; // the data returned from the API
		api.error = false; 	// errors and requst state
		
		api.remoteIP = api.res.connection.remoteAddress
				
		api.models.log.count({where: ["ip = ? AND createdAt > (NOW() - INTERVAL 1 HOUR)", api.remoteIP]}).on('success', function(requestThisHourSoFar) {
			api.requestCounter = requestThisHourSoFar + 1;

			api.params = {};
			api.postVariables.forEach(function(postVar){
				api.params[postVar] = api.req.param(postVar);
				if (api.params[postVar] === undefined){ api.params[postVar] = api.req.cookies[postVar]; }
			});
			
			if(api.params.limit == null){ api.params.limit = api.configData.defaultLimit; }
			if(api.params.offset == null){ api.params.offset = api.configData.defaultOffset; }

			if(api.configData.logRequests){api.log("request from " + req.connection.remoteAddress + " | params: " + JSON.stringify(api.params));}

			if(api.requestCounter <= api.configData.apiRequestLimit || api.configData.logRequests == false)
			{
				api.action = undefined;
				if(api.params["action"] == undefined)
				{
					api.params["action"] = api.req.params[0].split("/")[0];
				}
				if(api.params["action"] == undefined)
				{
		
					api.error = "You must provide an action. Use action=describeActions to see a list.";
					api.respondToClient();
				}
				else
				{
					if(api.actions[api.params["action"]] != undefined)
					{
						api.action = api.params["action"];
						api.actions[api.action](api, api.respondToClient);
					}
					else
					{
						api.error = "That is not a known action. Use action=describeActions to see a list.";
						api.respondToClient();
					}
				}
			}
			else
			{
				api.requestCounter = api.configData.apiRequestLimit;
				api.error = "You have exceded the limit of " + api.configData.apiRequestLimit + " requests this hour.";
				api.respondToClient();
			}
		})
	});
}

function initResponse(api)
{
	api.respondToClient = function(cont){
		var response = api.build_response(api.res);
		if(cont != false)
		{
	  		try{
				api.res.send(response);
			}catch(e)
			{
				
			}
		}
		if(api.configData.logRequests){api.log("request from " + api.req.connection.remoteAddress + " | response: " + JSON.stringify(response));}
		var logRecord = api.models.log.build({
			ip: api.req.connection.remoteAddress,
			action: api.action,
			error: api.error,
			params: JSON.stringify(api.params)
		});
		logRecord.save();
	};
}

////////////////////////////////////////////////////////////////////////////
// final flag
function initComplete(api)
{
	api.log("*** Server Started @ " + api.utils.sqlDateTime() + " @ port " + api.configData.serverPort + " ***");
}

////////////////////////////////////////////////////////////////////////////
// GO!

// Force NPM to be update... you probably don't want this in production
// exec = require('child_process').exec
// exec("npm update");

var api = api = api || {}; // the api namespace.  Everything uses this.

api.sys = require("sys"),
api.http = require("http"),
api.url = require("url"),
api.path = require("path"),
api.fs = require("fs");
api.SequelizeBase = require("sequelize");
api.expressServer = require('express');
api.async = require('async');

var templateValidator = require('validator').Validator;
api.validator = new templateValidator();
api.validator.error = function(msg){ api.error = msg; };

api.app = api.expressServer.createServer();
api.app.use(api.expressServer.cookieParser());
api.configData = JSON.parse(api.fs.readFileSync('config.json','utf8'));

api.async.series([
	initLogFolder(api),
	initRequires(api),
	initDB(api),
	initPostVariables(api),
	initActions(api),
	initCron(api),
	initResponse(api),
	initListen(api),
	initComplete(api),
]);

