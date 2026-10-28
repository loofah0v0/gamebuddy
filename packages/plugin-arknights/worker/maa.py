"""Isolated MAA ABI owner. JSON lines only on stdout; no credentials accepted."""
import ctypes as C
import json, os, sys, threading, time, tempfile, hashlib
from contextlib import ExitStack
from pathlib import Path
lock=threading.Lock()
def emit(kind,data):
 with lock:
  print(json.dumps({"type":kind,"data":data},ensure_ascii=False),flush=True)
stop=threading.Event()
def controls():
 for line in sys.stdin:
  try:
   if json.loads(line).get("type")=="stop":stop.set()
  except Exception:stop.set()
 stop.set()
def snapshot_base_plans(tasks, stack):
 """Validate the exact selected custom plan bytes, then give MAA an owned immutable copy.
 MAA custom mode ignores params.drones; its file can otherwise enable drone spending.
 """
 copied=json.loads(json.dumps(tasks))
 for task in copied:
  params=task.get("params",{})
  if task.get("type")!="Infrast" or params.get("mode")!=10000:continue
  source=Path(params["filename"])
  with source.open("rb") as f:data=f.read(2*1024*1024+1)
  if len(data)>2*1024*1024:raise RuntimeError("Custom base plan exceeds 2 MiB")
  def unique_pairs(pairs):
   result={}
   for key,value in pairs:
    if key in result:raise RuntimeError("Duplicate custom base plan key")
    result[key]=value
   return result
  value=json.loads(data.decode("utf-8-sig"),object_pairs_hook=unique_pairs)
  plans=value.get("plans") if isinstance(value,dict) else None
  index=params.get("plan_index",0)
  if not isinstance(plans,list) or type(index) is not int or index<0 or index>=len(plans) or not isinstance(plans[index],dict):
   raise RuntimeError("Custom base plan index invalid")
  drones=plans[index].get("drones")
  if "drones" in plans[index] and (not isinstance(drones,dict) or drones.get("enable") is not False):
   raise RuntimeError("Custom base plan enables drones or has unknown drone policy; choose normal shifting or disable drones in the selected plan")
  directory=stack.enter_context(tempfile.TemporaryDirectory(prefix="gameguy-base-plan-"))
  snapshot=Path(directory)/"plan.json";snapshot.write_bytes(data)
  params["filename"]=str(snapshot)
 return copied

def task_tree_digest(root):
 """Fail closed on changed/additional task resources, including hotfix overlays."""
 directory=Path(root)/"resource"/"tasks"
 if not directory.is_dir():raise RuntimeError("Collection task resources missing")
 rows=[];total=0
 for path in sorted(directory.rglob("*")):
  if path.is_symlink():raise RuntimeError("Collection resources must not contain symlinks")
  if not path.is_file():continue
  data=path.read_bytes();total+=len(data)
  if total>32*1024*1024:raise RuntimeError("Collection task resource budget exceeded")
  rows.append([path.relative_to(directory).as_posix(),hashlib.sha256(data).hexdigest()])
 return hashlib.sha256(json.dumps(rows,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()

def validate_collection(tasks, root, profile=None):
 custom=[t for t in tasks if t.get("type")=="Custom"]
 if not custom:return None
 if any(t.get("params")!={"task_names":["InfrastBegin"]} for t in custom):
  raise RuntimeError("Only fixed base collection Custom task is allowed")
 if profile is None:profile=json.loads(Path(__file__).with_name("collect-profile.json").read_text(encoding="utf-8"))
 if task_tree_digest(root)!=profile["taskTreeSha256"]:
  raise RuntimeError("Base collection resources changed or unsupported; not running shifts as a fallback")
 return profile

def main():
 request=json.loads(sys.stdin.readline())
 with ExitStack() as stack:
  request["tasks"]=snapshot_base_plans(request.get("tasks",[]),stack)
  return run(request)

def run(request):
 config=request["config"]
 root=Path(config["maaDir"]).resolve()
 if not root.is_dir():raise RuntimeError("MAA directory missing")
 collection=validate_collection(request.get("tasks",[]),root)
 os.chdir(root)
 dll_directory=os.add_dll_directory(str(root)) if os.name=="nt" else None
 lib=C.CDLL(str(root/"MaaCore.dll"))
 cbtype=C.CFUNCTYPE(None,C.c_int32,C.c_char_p,C.c_void_p)
 done=threading.Event();failed=[];finished=[]
 def callback(msg,payload,_):
  try:
   data=json.loads(payload.decode("utf-8")) if payload else {}
   # Allowlisted progress; exclude account names, UUID, raw adb and OCR payloads.
   safe={k:data[k] for k in ("taskchain","taskid","what","subtask") if k in data}
   safe["msg"]=msg
   if msg in (0,1,10000):failed.append(msg)
   if msg==3:
    finished.extend(data.get("finished_tasks",[]));done.set()
   emit("maa",safe)
  except Exception:
   failed.append(-1)
 cb=cbtype(callback)
 signatures={
  "AsstLoadResource":([C.c_char_p],C.c_uint8),"AsstSetUserDir":([C.c_char_p],C.c_uint8),
  "AsstCreateEx":([cbtype,C.c_void_p],C.c_void_p),"AsstDestroy":([C.c_void_p],None),
  "AsstAsyncConnect":([C.c_void_p,C.c_char_p,C.c_char_p,C.c_char_p,C.c_uint8],C.c_int32),
  "AsstConnected":([C.c_void_p],C.c_uint8),"AsstAppendTask":([C.c_void_p,C.c_char_p,C.c_char_p],C.c_int32),
  "AsstStart":([C.c_void_p],C.c_uint8),"AsstStop":([C.c_void_p],C.c_uint8),"AsstRunning":([C.c_void_p],C.c_uint8),
  "AsstGetVersion":([],C.c_char_p)}
 for name,(args,ret) in signatures.items():
  f=getattr(lib,name);f.argtypes=args;f.restype=ret
 if not lib.AsstSetUserDir(str(root).encode()):raise RuntimeError("MAA user directory rejected")
 if not lib.AsstLoadResource(str(root).encode()):raise RuntimeError("MAA resources rejected")
 version=lib.AsstGetVersion().decode()
 if collection and version!=collection["version"]:
  raise RuntimeError("Base collection MaaCore version unsupported: "+version)
 emit("backend",{"version":version})
 if collection:emit("collection-policy",{"profile":collection["version"],"task":"InfrastBegin","shift":False,"drones":False,"resourceDigestVerified":True})
 if request["type"]=="version":emit("result",{"version":lib.AsstGetVersion().decode(),"resourceLoaded":True});return
 threading.Thread(target=controls,daemon=True).start()
 handle=lib.AsstCreateEx(cb,None)
 if not handle:raise RuntimeError("MAA instance initialization failed")
 try:
  lib.AsstAsyncConnect(handle,config["adbPath"].encode(),config["address"].encode(),config["connection"].encode(),1)
  if stop.is_set():raise RuntimeError("stopped before start")
  if not lib.AsstConnected(handle):raise RuntimeError("MAA device connection failed; run diagnosis")
  ids=[]
  for task in request["tasks"]:
   tid=lib.AsstAppendTask(handle,task["type"].encode(),json.dumps(task["params"]).encode())
   if tid<=0:raise RuntimeError("MAA task rejected: "+task["type"])
   ids.append(tid)
  if not lib.AsstStart(handle):raise RuntimeError("MAA start failed")
  while not done.wait(0.1):
   if stop.is_set():lib.AsstStop(handle);raise RuntimeError("MAA stopped; last action outcome unknown")
   if not lib.AsstRunning(handle):
    if not done.wait(2):raise RuntimeError("MAA ended without completion receipt")
  if failed:raise RuntimeError("MAA reported task chain/internal failure; partial progress retained")
  if any(tid not in finished for tid in ids):raise RuntimeError("MAA completion receipt missing planned task IDs")
  emit("result",{"status":"backend-completed","finishedTaskIds":finished,"rewardsIndependentlyVerified":False})
 finally:
  lib.AsstStop(handle);lib.AsstDestroy(handle)
if __name__=="__main__":
 try:main()
 except Exception as error:
  emit("error",str(error));sys.exit(1)
