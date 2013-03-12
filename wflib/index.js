/* Hypermedia workflow. 
 ** API over redis-backed workflow instance
 ** Author: Bartosz Balis (2013)
 */
var fs = require('fs'),
    redis = require('redis'),
    async = require('async'),
    rcl;

exports.init = function(redisClient) {
    // FIXME: only this module should have a connection to redis. Currently app.js creates
    // the client which has to be passed around other modules. (For testing purposes
    // optional passing of client could be possible);
    if (redisClient) {
	rcl = redisClient;
    }
    /*rcl.on("error", function (err) {
	console.log("redis error: " + err);
    });*/

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////
    
    function public_createInstanceFromFile(filename, baseUrl, cb) {
        fs.readFile(filename, 'utf8', function(err, data) {
            if (err) { 
                throw(err);
            } else {
                var wfname = filename.split('.')[0];
                rcl.hmset("wftempl:"+wfname, "name", wfname, "maxInstances", "3", function(err, ret) { 
                    var start = (new Date()).getTime(), finish;
                    public_createInstance(JSON.parse(data), baseUrl, function(err, ret) {
                        finish = (new Date()).getTime();
                        console.log("createInstance time: "+(finish-start)+"ms");
                        err ? cb(err): cb(null, ret);
                    });
                });
            }
        });
    }

    // creates a new workflow instance from its JSON representation
    function public_createInstance(wfJson, baseUrl, cb) { 
        var instanceId;
	var start, finish; 
        rcl.incrby("wfglobal:nextId", 1, function(err, ret) {
            if (err) { throw(err); }
            instanceId = ret.toString();
            console.log("instanceId="+instanceId);
            createWfInstance(wfJson, baseUrl, instanceId, function(err) {
                cb(null, instanceId);
            });
        });
    }

    // TODO: currently workflow template is not stored in redis. Pegasus-specific
    // getTemplate is implemented in Pegasus dax workflow factory.
    function public_getWfTemplate(wfname, cb) {

    }

    // returns a list of tasks with ids within [from..to], and their ins and outs
    function public_getWfTasks(wfId, from, to, cb) {
        rcl.zcard("wf:"+wfId+":data", function(err, ret) {
            var dataNum = ret;
            if (to < 0) {
                rcl.zcard("wf:"+wfId+":tasks", function(err, ret) {
                    if (err) {
                        console.log("Error zcard: "+err);
                    }
                    var to1 = ret+to+1;
                    //console.log("From: "+from+", to: "+to1);
                    getTasks1(wfId, from, to1, dataNum, cb);
                });
            }  else {
                getTasks1(wfId, from, to, dataNum, cb);
            }
        });
    }

    // returns list of URIs of instances, ...
    function public_getWfInfo(wfName, cb) {
	    cb(null, []);
    }

    // returns a JSON object with fields uri, status, nTasks, nData
    // FIXME: currently also returns nextTaskId, nextDataId
    function public_getWfInstanceInfo(wfId, cb) {
	var multi = rcl.multi();
        multi.zcard("wf:"+wfId+":tasks", function(err, ret) { });
        multi.zcard("wf:"+wfId+":data", function(err, ret) { });
	multi.hgetall("wf:"+wfId, function(err, ret) { });
        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		replies[2].nTasks = replies[0];
		replies[2].nData = replies[1];
                cb(null, replies[2]);
            }
        });
    }

    function public_setWfInstanceState(wfId, obj, cb) {
	rcl.hmset("wf:"+wfId, obj, function(err, rep) {
	    cb(err, rep);
	});
    }

    function public_getWfIns(wfId, withports, cb) {
	if (withports) {
	    rcl.zrangebyscore("wf:"+wfId+":ins", 0, "+inf", "withscores", function(err, ret) { 
		err ? cb(err): cb(null, ret);
	    });
	} else {
	    rcl.zrangebyscore("wf:"+wfId+":ins", 0, "+inf", function(err, ret) { 
		err ? cb(err): cb(null, ret);
	    });
	}
    }

    function public_getWfOuts(wfId, withports, cb) {
	if (withports) {
	    rcl.zrangebyscore("wf:"+wfId+":outs", 0, "+inf", "withscores", function(err, ret) { 
		err ? cb(err): cb(null, ret);
	    });
	} else {
	    rcl.zrangebyscore("wf:"+wfId+":outs", 0, "+inf", function(err, ret) { 
		err ? cb(err): cb(null, ret);
	    });
	}
    }

    function public_getTaskInfo(wfId, taskId, cb) {
	var taskKey = "wf:"+wfId+":task:"+taskId;
	var task, ins, outs, data = {};

	var multi = rcl.multi();

	// Retrieve task info
	multi.hgetall(taskKey, function(err, reply) {
            err ? cb(err): cb(null, reply);
	});
    }

    function public_getTaskIns(wfId, taskId, withports, cb) {
	var taskKey = "wf:"+wfId+":task:"+taskId;
	if (withports) {
	    rcl.zrangebyscore(taskKey+":ins", 0, "+inf", "withscores", function(err, ret) { 
                err ? cb(err): cb(null, ret);
	    });
	} else {
	    rcl.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
                err ? cb(err): cb(null, ret);
	    });
	}
    }

    function public_getTaskOuts(wfId, taskId, withports, cb) {
	var taskKey = "wf:"+wfId+":task:"+taskId;
	if (withports) {
	    rcl.zrangebyscore(taskKey+":outs", 0, "+inf", "withscores", function(err, ret) { 
                err ? cb(err): cb(null, ret);
	    });
	} else {
	    rcl.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
                err ? cb(err): cb(null, ret);
	    });
	}
    }

    // returns full task info
    function public_getTaskInfoFull(wfId, taskId, cb) {
	var taskKey = "wf:"+wfId+":task:"+taskId;
	var task, ins, outs, data = {};

	var multi = rcl.multi();

	// Retrieve task info
	multi.hgetall(taskKey, function(err, reply) {
            task = err ? err: reply;
	});

	// Retrieve all ids of inputs of the task
	multi.sort(taskKey+":ins", function(err, reply) {
            ins = err ? err: reply;
	});

	// Retrieve all ids of outputs of the task
	multi.sort(taskKey+":outs", function(err, reply) {
            outs = err ? err: reply;
	});

        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		for (var i=0; i<ins.length; ++i) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+ins[i];
			multi.hmget(dataKey, "uri", "name", "status", function(err, reply) {
			    if (err) {
				data[ins[i]] = err;
			    } else {
				data[ins[i]] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
			    }
			});
		    })(i);
		}
		for (var i=0; i<outs.length; ++i) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+outs[i];
			multi.hmget(dataKey, "uri", "name", "status", function(err, reply) {
			    if (err) {
				data[outs[i]] = err;
			    } else {
				data[outs[i]] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
			    }
			});
		    })(i);
		}

		multi.exec(function(err, replies) {
		    if (err) {
			console.log(err);
			cb(err);
		    } else {
			// replace ids of data elements with their attributes
			for (var i=0; i<ins.length; ++i) {
			    ins[i] = data[ins[i]];
			}
			for (var i=0; i<outs.length; ++i) {
			    outs[i] = data[outs[i]];
			}
			cb(null, task, ins, outs);
		    }
		});
            }
        });
    }

    function public_setTaskState(wfId, taskId, obj, cb) {
	rcl.hmset("wf:"+wfId+":task:"+taskId, obj, function(err, rep) {
	    cb(err, rep);
	});
    }

    function public_getDataInfo(wfId, dataId, cb) {
	var data, nSources, nSinks, dataKey; 
	var multi = rcl.multi();

	dataKey = "wf:"+wfId+":data:"+dataId;
	taskKeyPfx = "wf:"+wfId+":task:";

	// Retrieve data element info
	multi.hgetall(dataKey, function(err, reply) {
            data = err ? err: reply;
	});

	multi.zcard(dataKey+":sources", function(err, ret) {
		nSources = err ? err : ret;
	});

	multi.zcard(dataKey+":sinks", function(err, ret) {
		nSinks = err ? err : ret;
	});

        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		data.nSources = nSources;
		data.nSinks = nSinks;
		cb(null, data);
	    }
	});
    }

    // returns full data element info
    function public_getDataInfoFull(wfId, dataId, cb) {
	var data, sources, sinks, dataKey, taskKeyPfx, tasks = {};
	var multi = rcl.multi();

	dataKey = "wf:"+wfId+":data:"+dataId;
	taskKeyPfx = "wf:"+wfId+":task:";

	// Retrieve data element info
	multi.hgetall(dataKey, function(err, reply) {
            data = err ? err: reply;
	});

	// this is a great feature: sort+get combo (even for hashes)!
	multi.sort(dataKey+":sources", "get", taskKeyPfx+"*->uri",
			               "get", taskKeyPfx+"*->name",
			               "get", taskKeyPfx+"*->status",
	function(err, reply) {
	    if (err) {
		sources = err;
	    } else {
		sources = [];
		for (var i=0; i<reply.length; i+=3) {
			sources.push({"uri": reply[i], "name": reply[i+1], "status": reply[i+2]});
		}
		//console.log("sources[0]: "+sources[0]);
	    }
	});

	multi.sort(dataKey+":sinks", "get", taskKeyPfx+"*->uri",
			             "get", taskKeyPfx+"*->name",
			             "get", taskKeyPfx+"*->status",
	function(err, reply) {
	    if (err) {
		sinks = err;
	    } else {
	        sinks = [];	
		for (var i=0; i<reply.length; i+=3) {
			sinks.push({"uri": reply[i], "name": reply[i+1], "status": reply[i+2]});
		}
		//console.log("sinks[0]: "+sinks[0]);
	    }
	});

        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		cb(null, data, sources, sinks);
	    }
	});
    }

    function public_setDataState(wfId, dataId, obj, cb) {
	rcl.hmset("wf:"+wfId+":data:"+dataId, obj, function(err, rep) {
	    cb(err, rep);
	});
    }

    // Returns a 'map' of a workflow. Should be passed a callback:
    // function(nTasks, nData, err, ins, outs, sources, sinks), where:
    // - nTasks        = number of tasks (also length-1 of ins and outs arrays)
    // - nData         = number of data elements (also length-1 of sources and sinks arrays)
    // - ins[i][j]     = data id mapped to j-th output port of i-th task
    // - outs[i][j]    = data id mapped to j-th input port of i-th task
    // - sources[i][1] = task id which produces data element with id=i (if none, sources[i]=[])
    // - sources[i][2] = port id in this task the data element is mapped to
    // - sinks[i][j]   = task id which consumes data element with id=i (if none, sinks[i]=[])
    // - sinks[i][j+1] = port id in this task the data element is mapped to
    function public_getWfMap(wfId, cb) {
	rcl.zcard("wf:"+wfId+":tasks", function(err, ret) {
	    var nTasks = ret; 
	    rcl.zcard("wf:"+wfId+":data", function(err, ret) {
		var nData = ret;
		var ins = [], outs = [], sources = [], sinks = [], taskKey;
		var multi = rcl.multi();
		for (var i=1; i<=nTasks; ++i) {
		    (function(i) {
			taskKey = "wf:"+wfId+":task:"+i;
			multi.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
			    ins[i] = ret;
			    ins[i].unshift(null); // inputs will be indexed from 1 instead of 0
			});
			multi.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
			    outs[i] = ret;
			    outs[i].unshift(null);
			});
		    })(i);
		}
		for (i=1; i<=nData; ++i) {
		    (function(i) {
			dataKey = "wf:"+wfId+":data:"+i;
			multi.zrangebyscore(dataKey+":sources", 0, "+inf", "withscores", function(err, ret) { 
			    sources[i] = ret;
			    //console.log(i+";"+ret);
			    sources[i].unshift(null);
			});
			/*multi.zrangebyscore(dataKey+":sinks", 0, "+inf", "withscores", function(err, ret) { 
			    if (err) {
				console.log("aaa   "+err);
			    }
			    sinks[i] = ret;
			    //sinks[i].unshift(null);
			});*/
		    })(i);
		}
		multi.exec(function(err, reps) {
		    if (err) {
			cb(err);
		    } else {
			cb(null, nTasks, nData, ins, outs, sources, sinks);
		    }
		});
	    });
	});
    }

    /*
     * returns task map, e.g.:
     * ins  = [1,4] ==> input data ids
     * outs = [2,3] ==> output data ids
     * sources = { 1: [], 4: [] }  
     *                      ==> which task(s) (if any) produced a given input
     * sinks   = { 2: [108,1,33,3], 3: [108,2,33,4] } 
     *                      ==> which task(s) (if any) consume a given output
     *                          "108,1" means task 108, port id 1
     */
    function public_getTaskMap(wfId, taskId, cb) {
	var ins = [], outs = [], sources = {}, sinks = {};
	var multi = rcl.multi();
	var taskKey = "wf:"+wfId+":task:"+taskId;
	multi.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
	    //console.log(ret);
	    ins = ret;
	});
	multi.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
	    //console.log(ret);
	    outs = ret;
	});
	multi.exec(function(err, reps) {
	    if (err) {
		cb(err);
	    } else {
		for (var i in ins) {
		    (function(i) {
			//console.log(ins[i]);
			var dataKey = "wf:"+wfId+":data:"+ins[i];
			multi.zrangebyscore(dataKey+":sources", 0, "+inf", "withscores", function(err, ret) { 
			    sources[ins[i]] = ret;
			});
		    })(i);
		}
		for (var i in outs) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+outs[i];
			multi.zrangebyscore(dataKey+":sinks", 0, "+inf", "withscores", function(err, ret) { 
			    sinks[outs[i]] = ret;
			});
		    })(i);
		}
		multi.exec(function(err, reps) {
		    cb(null, ins, outs, sources, sinks);
		});
	    }
	});
    }

    function public_getDataSources(wfId, dataId, cb) {
	var dataKey = "wf:"+wfId+":data:"+dataId;
	rcl.zrangebyscore(dataKey+":sources", 0, "+inf", "withscores", function(err, ret) { 
            err ? cb(err): cb(null, ret);
	});
    }

    // Retrieves a list of data sinks (tasks). FIXME: workaround for very big lists:
    // retrieves a chunk of 1000 elements at a time from redis, because on windows 
    // (redis 2.4.x) larger replies sometimes don't work (probably a bug...)
    function public_getDataSinks(wfId, dataId, cb) {
	var replies = [], reply = [];
	var dataKey = "wf:"+wfId+":data:"+dataId;
	var multi = rcl.multi();

	rcl.zcard(dataKey+":sinks", function(err, rep) {
	    for (var i=0,j=1; i<=rep; i+=1000,j++) {
		(function(i,j) {
		    multi.zrangebyscore(
			dataKey+":sinks", 0, "+inf", "withscores", "limit", i, "1000", 
			function(err, ret) { 
			replies[j] = ret;
			//console.log(replies[j].length);
		    });
		})(i,j);
	    }
	    multi.exec(function(err, replies) {
		if (err) {
		    cb(err);
		} else {
		    for (var i=0; i<replies.length; ++i) {
			reply = reply.concat(replies[i]);
		    }
		    //console.log(reply);
		    cb(null, reply);
		}
	    });
	});
    }

    // Retrieves a list of remote data sinks (tasks). Such sinks are notified over
    // HTTP using their full URI. FIXME: workaround for very big lists: 
    // retrieves a chunk of 1000 elements at a time from redis, because on windows 
    // (redis 2.4.x) larger replies sometimes don't work (probably a bug...)
    function public_getRemoteDataSinks(wfId, dataId, cb) {
	var replies = [], reply = [];
	var dataKey = "wf:"+wfId+":data:"+dataId;
	var multi = rcl.multi();

	rcl.zcard(dataKey+":sinks", function(err, rep) {
	    for (var i=0,j=1; i<=rep; i+=1000,j++) {
		(function(i,j) {
		    // if score (port id) = -1, the sink is remote
		    multi.zrangebyscore(
			dataKey+":sinks", -1, -1, "withscores", "limit", i, "1000", 
			function(err, ret) { 
			    replies[j] = ret;
			    //console.log(replies[j].length);
			});
		})(i,j);
	    }
	    multi.exec(function(err, replies) {
		if (err) {
		    cb(err);
		} else {
		    for (var i=0; i<replies.length; ++i) {
			reply = reply.concat(replies[i]);
		    }
		    // retrieve URIs and store them instead of 
		    for (var i=0; i<reply.length; i+=2) {
			(function(i) {
			    var dataKey = "wf:"+wfId+":data:"+reply[i];
			    multi.hmget(dataKey, "uri", function(err, rep) {
				reply[i+1] = rep;
			    });
			})(i);
		    }
		    multi.exec(function(err, reps) {
			cb(null, reply);
		    });
		}
	    });
	});
    }


    return {
        createInstance: public_createInstance,
        createInstanceFromFile: public_createInstanceFromFile,
	getWfInfo: public_getWfInfo,
	getWfInstanceInfo: public_getWfInstanceInfo,
	setWfInstanceState: public_setWfInstanceState,
	getWfTasks: public_getWfTasks,
	getWfIns: public_getWfIns,
	getWfOuts: public_getWfOuts,
	getTaskInfo: public_getTaskInfo,
	getTaskInfoFull: public_getTaskInfoFull,
	getTaskIns: public_getTaskIns,
	getTaskOuts: public_getTaskOuts,
	setTaskState: public_setTaskState,
	getDataInfo: public_getDataInfo,
        getDataInfoFull: public_getDataInfoFull,
	setDataState: public_setDataState,
        getDataSources: public_getDataSinks,
        getDataSinks: public_getDataSinks,
	getRemoteDataSinks: public_getRemoteDataSinks,
	getWfMap: public_getWfMap,
	getTaskMap: public_getTaskMap
    };

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function createWfInstance(wfJson, baseUrl, instanceId, cb) {
        var wfname = wfJson.name;
        var baseUri = baseUrl + '/workflow/' + wfname + '/instances/' + instanceId;
        var wfKey = "wf:"+instanceId;
        rcl.hmset(wfKey, "uri", baseUri, 
                         "status", "waiting", 
                         function(err, ret) { });

        // add workflow tasks
        var taskKey;
        for (var i=0; i<wfJson.tasks.length; ++i) {
            var taskId = i+1;
            taskKey = wfKey+":task:"+taskId;
            processTask(wfJson.tasks[i], wfname, baseUri, wfKey, taskKey, taskId, function() { });
        }

        // add workflow data
        var multi = rcl.multi();
        var dataKey;
        for (var i=0; i<wfJson.data.length; ++i) {
            (function(i) {
                var dataId = i+1;
                dataKey = wfKey+":data:"+dataId;
                multi.hmset(dataKey, 
                        "uri", baseUri + '/data-' + dataId, 
                        "name", wfJson.data[i].name, 
                        "status", "not_ready", 
                        function(err, ret) { });

                // add this data id to the sorted set of all workflow data
                // score: 0 (data not ready) or 1 (data ready)
                multi.zadd(wfKey+":data", 0 /* score */, dataId, function(err, ret) { });
            })(i);
        }

        // add workflow inputs and outputs
        for (var i=0; i<wfJson.ins.length; ++i) {
            (function(inId, dataId) {
                multi.zadd(wfKey+":ins", inId, dataId, function(err, rep) { });
            })(i+1, wfJson.ins[i]+1);
        }
        for (var i=0; i<wfJson.outs.length; ++i) {
            (function(outId, dataId) {
                multi.zadd(wfKey+":outs", outId, dataId, function(err, rep) { });
            })(i+1, wfJson.outs[i]+1);
        }
        multi.exec(function(err, replies) {
            console.log('Done processing jobs.'); 
            cb(err);
        });
    }

    function processTask(task, wfname, baseUri, wfKey, taskKey, taskId, cb) {
        var multi=rcl.multi();
        multi.hmset(taskKey, 
                "uri", baseUri+"/task-"+taskId, 
                "name", task.name, 
                "status", "waiting", 
                "execName", task.name, 
                "execArgs", task.execArgs, 
                // mapping data for simple ssh-based execution. In the future will probably be
                // a separate mapping data structure
                "execSSHAddr", "balis@192.168.252.130", 
                function(err, ret) { });

        // add task id to sorted set of all wf tasks. Score 0/1/2==waiting/running/finished
        // only task Id (not key) is added which allows redis to optimize memory consumption 
        multi.zadd(wfKey+":tasks", 0 /* score */, taskId, function(err, ret) { });

        // add task inputs and outputs + data sources and sinks
        for (var i=0; i<task.ins.length; ++i) {
            (function(inId, dataId) {
                var dataKey = wfKey+":data:"+dataId;
                multi.zadd(taskKey+":ins", inId, dataId, function(err, rep) { });
                multi.zadd(dataKey+":sinks", inId /* score: port id */ , taskId, function(err, ret) { });
            })(i+1, task.ins[i]+1);
        }
        for (var i=0; i<task.outs.length; ++i) {
            (function(outId, dataId) {
                var dataKey = wfKey+":data:"+dataId;
                multi.zadd(taskKey+":outs", outId, dataId, function(err, rep) { });
                multi.zadd(dataKey+":sources", outId /* score: port Id */, taskId, function(err, ret) { });
            })(i+1, task.outs[i]+1);
        }
        multi.exec(function(err, replies) {
            cb();
        });
    }

    // TODO: rewrite this to use multi instead of async.parallel ?
    function getTasks1(wfId, from, to, dataNum, cb) {
        var tasks = [], ins = [], outs = [], data  = [];
        var asyncTasks = [];
	var start, finish;
	start = (new Date()).getTime();
        for (var i=from; i<=to; ++i) {
            // The following "push" calls need to be wrapped in an anynomous function to create 
            // a separate scope for each value of "i". See http://stackoverflow.com/questions/2568966
            (function(i) {
                var taskKey = "wf:"+wfId+":task:"+i;
                // Retrieve task info
                asyncTasks.push(function(callback) {
                    rcl.hmget(taskKey, "uri", "name", "status", function(err, reply) {
                        if (err) {
                            tasks[i-from] = err;
                            callback(err);
                        } else {
                            tasks[i-from] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
                            callback(null, reply);
                        }
                    });
                });

                // Retrieve all ids of inputs of the task
                asyncTasks.push(function(callback) {
                    rcl.sort(taskKey+":ins", function(err, reply) {
                        if (err) {
                            ins[i-from] = err;
                            callback(err);
                        } else {
		            ins[i-from] = reply;
			    callback(null, reply);
			}
		    });
		});

                // Retrieve all ids of outputs of the task
                asyncTasks.push(function(callback) {
                    rcl.sort(taskKey+":outs", function(err, reply) {
                        if (err) {
                            outs[i-from] = err;
                            callback(err);
                        } else {
		            outs[i-from] = reply;
			    callback(null, reply);
			}
		    });
		});

            })(i);
        }

	// Retrieve info about ALL data elements (of this wf instance). 
	// FIXME: can it be done better (more efficiently)? 
	// - Could be cached in node process's memory but then data may not be fresh.
	// - We could calculate which subset of data elements we need exactly but that
	//   implies additional processing and more complex data structures...
	// - MULTI instead of many parallel tasks?
        for (var i=1; i<=dataNum; ++i) {
            (function(i) {
                var dataKey = "wf:"+wfId+":data:"+i;
                asyncTasks.push(function(callback) {
                    rcl.hmget(dataKey, "uri", "name", "status", function(err, reply) {
                        if (err) {
                            data[i] = err;
                            callback(err);
                        } else {
                            data[i] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
                            callback(null, reply);
                        }
                    });
                });
	    })(i);
	}

	console.log("async tasks: "+asyncTasks.length);

	async.parallel(asyncTasks, function done(err, result) {
            if (err) {
                console.log(err);
                cb(err);
            } else {
	        finish = (new Date()).getTime();
	        console.log("getTasks exec time: "+(finish-start)+"ms");

		// replace ids of data elements with their attributes
		for (var i=0; i<tasks.length; ++i) {
			for (var j=0; j<ins[i].length; ++j) {
				ins[i][j] = data[ins[i][j]];
			}
			for (var k=0; k<outs[i].length; ++k) {
				outs[i][k] = data[outs[i][k]];
			}
		}

                cb(null, tasks, ins, outs);
            }
        });
    }
};
