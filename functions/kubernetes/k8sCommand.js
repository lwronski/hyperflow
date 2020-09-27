// Runs a job as a Pod (Kubernetes Job) in a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
var BufferManager = require('./buffer_manager.js').BufferManager;
var RestartCounter = require('./restart_counter.js').RestartCounter;
var submitK8sJob = require('./k8sJobSubmit.js').submitK8sJob;
var fs = require('fs');

let bufferManager = new BufferManager();

let backoffLimit = process.env.HF_VAR_BACKOFF_LIMIT || 0;
let restartCounter = new RestartCounter(backoffLimit);

// Function k8sCommandGroup
//
// Inputs:
// - bufferItems - array containing objects with following properties:
//   * ins
//   * outs
//   * context
//   * cb
async function k8sCommandGroup(bufferItems) {

  // No action needed when buffer is empty
  if (bufferItems.length == 0) {
    return;
  }

  let startTime = Date.now();
  console.log("k8sCommandGroup started, time:", startTime);

  // Function for rebuffering items
  let restartFn = (bufferIndex) => {
    let bufferItem = bufferItems[bufferIndex];
    let taskId = bufferItem.context.taskId;
    if (restartCounter.isRestartPossible(taskId)) {
      let restartVal = restartCounter.increase(taskId);
      console.log("Readding task", taskId, "to buffer (restartCount:", restartVal + ") ...");
      let itemName = bufferItem.context.name;
      bufferManager.addItem(itemName, bufferItem);
    }
    return;
  }

  // Extract particular arrays from buffer items
  let jobArr = [];
  let taskIdArr = [];
  let contextArr = [];
  let cbArr = [];
  for (let i=0; i<bufferItems.length; i++) {
    let bufferItem = bufferItems[i];
    let ins = bufferItem.ins;
    let outs = bufferItem.outs;
    let context = bufferItem.context;
    let cb = bufferItem.cb;

    var job = context.executor; // object containing 'executable', 'args' and others
    job.name = context.name;
    job.ins = ins;
    job.outs = outs;

    jobArr.push(job);
    taskIdArr.push(context.taskId);
    contextArr.push(context);
    cbArr.push(cb);
  }

  let context = contextArr[0];

  // let cluster = await getCluster();
  // const token = await getGCPToken();

  // support for two (or more) clusters (for cloud bursting)
  // if 'partition' is defined, check if there is a custom config file
  // for that partition. This config file may override parameters of the job,
  // possibly even define a path to a different kube_config to be loaded
  let partition = context.executor.partition;
  let partitionConfigDir = process.env.HF_VAR_PARTITION_CONFIG_DIR || "/opt/hyperflow/partitions";
  let partitionConfigFile = partitionConfigDir + "/" + "part." + partition + ".config.json";

  // custom parameters for the job YAML template (will overwrite default values)
  var customParams = {};
  try {
    // if file exists, all configuration parameters will be read to 'customParams'
    let rawdata = fs.readFileSync(partitionConfigFile);
    customParams = JSON.parse(rawdata);
  } catch {
  }
  console.log(partitionConfigFile);
  console.log("CUSTOM...", customParams);

  // Set kube_config path if overridden
  if (customParams.kubeConfigPath) {
      process.env.KUBECONFIG = customParams.kubeConfigPath;
      console.log(process.env.KUBECONFIG);
  }

  const kubeconfig = new k8s.KubeConfig();
  kubeconfig.loadFromDefault(); // loadFromString(JSON.stringify(kconfig))

  let jobExitCodes = [];
  try {
    jobExitCodes = await submitK8sJob(kubeconfig, jobArr, taskIdArr, contextArr, customParams, restartFn);
  } catch (err) {
    console.log("Error when submitting job:", err);
    throw err;
  }

  let endTime = Date.now();
  console.log("Ending k8sCommandGroup function, time:", endTime, "exit codes:", jobExitCodes);

  // Stop the entire workflow if a job fails (controlled by an environment variable)
  for (var i=0; i<jobExitCodes.length; i++) {
    let jobExitCode = jobExitCodes[i];
    if (jobExitCode != 0 && process.env.HF_VAR_STOP_WORKFLOW_WHEN_JOB_FAILED=="1") {
      let taskId = taskIdArr[i];
      let job = jobArr[i];
      console.log('Error: job', taskId, 'exited with error code', jobExitCode, ', stopping workflow.');
      console.log('Error details: job.name: ' + job.name + ', job.args: ' + job.args.join(' '));
      process.exit(1);
    }
  }

  // if we're here, the job should have succesfully completed -- we write this
  // information to Redis (job executor may make use of it).
  let markPromises = [];
  for (var i=0; i<contextArr.length; i++) {
    // skip failed jobs
    if (jobExitCodes[i] != 0) {
      continue;
    }

    let context = contextArr[i];
    markPromises.push(context.markTaskCompleted());
  }
  try {
    await Promise.all(markPromises);
  } catch {
    console.error("Marking jobs", taskIdArr, "as completed failed.")
  }

  for (var i=0; i<cbArr.length; i++) {
    // skip failed jobs
    if (jobExitCodes[i] != 0) {
      continue;
    }

    let cb = cbArr[i];
    let outs = jobArr[i].outs;
    cb(null, outs);
  }

  return;
}

bufferManager.setCallback((items) => k8sCommandGroup(items));

async function k8sCommand(ins, outs, context, cb) {
  /** Buffer Manager configuration. */
  buffersConf = context.appConfig.jobAgglomerations;
  let alreadyConfigured = bufferManager.isConfigured();
  if (alreadyConfigured == false && buffersConf != undefined) {
    bufferManager.configure(buffersConf);
  }

  /** Buffer item. */
  let item = {
    "ins": ins,
    "outs": outs,
    "context": context,
    "cb": cb
  };
  bufferManager.addItem(context.name, item);

  return;
}

exports.k8sCommand = k8sCommand;
