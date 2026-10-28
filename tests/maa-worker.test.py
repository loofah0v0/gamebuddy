"""File-only tests: never load MaaCore, connect devices or run game tasks."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from contextlib import ExitStack
spec=importlib.util.spec_from_file_location("maa_worker",Path(__file__).resolve().parents[1]/"packages/plugin-arknights/worker/maa.py")
maa=importlib.util.module_from_spec(spec);spec.loader.exec_module(maa)
class BasePlanSnapshot(unittest.TestCase):
 def setUp(self):
  self.dir=tempfile.TemporaryDirectory(prefix="gameguy-worker-test-");self.addCleanup(self.dir.cleanup);self.path=Path(self.dir.name)/"base.json"
 def tasks(self,index=0):return [{"type":"Infrast","params":{"mode":10000,"filename":str(self.path),"plan_index":index,"drones":"_NotUse"}}]
 def write(self,plans):self.path.write_text(json.dumps({"plans":plans}),encoding="utf-8")
 def test_normal_mode_does_not_read_any_file(self):
  tasks=[{"type":"Infrast","params":{"mode":0,"filename":"missing"}}]
  with ExitStack() as stack:self.assertEqual(maa.snapshot_base_plans(tasks,stack),tasks)
 def test_snapshot_detached_stable_and_cleaned(self):
  self.write([{}, {"drones":{"enable":False}}]);original=self.path.read_bytes();tasks=self.tasks(1)
  with ExitStack() as stack:
   result=maa.snapshot_base_plans(tasks,stack);snapshot=Path(result[0]["params"]["filename"])
   self.assertEqual(snapshot.read_bytes(),original);self.assertEqual(result[0]["params"]["plan_index"],1)
   self.assertEqual(tasks[0]["params"]["filename"],str(self.path));self.assertEqual(self.path.read_bytes(),original)
   self.write([{"drones":{"enable":True}}]);self.assertEqual(snapshot.read_bytes(),original)
  self.assertFalse(snapshot.exists());self.assertTrue(self.path.exists())
 def test_absent_or_explicitly_disabled_drones(self):
  for plan in [{},{"drones":{"enable":False}},{"drones":{"enable":False,"room":"Trade"}}]:
   self.write([plan])
   with ExitStack() as stack:maa.snapshot_base_plans(self.tasks(),stack)
 def test_enabled_unknown_or_malformed_drones_rejected(self):
  for drones in [{"enable":True},{},{"enable":0},{"enable":"false"},None,[],"_NotUse"]:
   self.write([{"drones":drones}])
   with ExitStack() as stack,self.assertRaisesRegex(RuntimeError,"drone"):maa.snapshot_base_plans(self.tasks(),stack)
 def test_other_plan_drone_policy_does_not_widen_selected_plan(self):
  self.write([{"drones":{"enable":True}},{}])
  with ExitStack() as stack:maa.snapshot_base_plans(self.tasks(1),stack)
 def test_invalid_index_or_structure_rejected(self):
  self.write([{}])
  for index in [-1,1,True,"0"]:
   with ExitStack() as stack,self.assertRaisesRegex(RuntimeError,"index"):maa.snapshot_base_plans(self.tasks(index),stack)
  self.write([None])
  with ExitStack() as stack,self.assertRaises(RuntimeError):maa.snapshot_base_plans(self.tasks(),stack)
 def test_duplicate_keys_rejected(self):
  self.path.write_text('{"plans":[{"drones":{"enable":true,"enable":false}}]}',encoding="utf-8")
  with ExitStack() as stack,self.assertRaisesRegex(RuntimeError,"Duplicate"):maa.snapshot_base_plans(self.tasks(),stack)
 def test_size_budget_and_utf8_bom(self):
  self.path.write_bytes(b"x"*(2*1024*1024+1))
  with ExitStack() as stack,self.assertRaisesRegex(RuntimeError,"2 MiB"):maa.snapshot_base_plans(self.tasks(),stack)
  self.path.write_bytes(b'\xef\xbb\xbf'+b'{"plans":[{}]}')
  with ExitStack() as stack:self.assertEqual(Path(maa.snapshot_base_plans(self.tasks(),stack)[0]["params"]["filename"]).read_bytes(),self.path.read_bytes())
class CollectionPolicy(unittest.TestCase):
 def setUp(self):
  self.dir=tempfile.TemporaryDirectory();self.addCleanup(self.dir.cleanup);self.root=Path(self.dir.name)
  self.tasks=self.root/"resource"/"tasks";self.tasks.mkdir(parents=True)
  (self.tasks/"tasks.json").write_text('{"InfrastBegin":{"next":["Stop"]}}',encoding="utf-8")
  self.profile={"version":"v6.20.1","taskTreeSha256":maa.task_tree_digest(self.root)}
  self.plan=[{"type":"Custom","params":{"task_names":["InfrastBegin"]}}]
 def test_fixed_collection_matches_profile(self):
  self.assertEqual(maa.validate_collection(self.plan,self.root,self.profile),self.profile)
  self.assertIsNone(maa.validate_collection([{"type":"Infrast","params":{"mode":0}}],self.root,self.profile))
 def test_arbitrary_custom_rejected(self):
  for params in [{"task_names":["InfrastEnterRotation"]},{"task_names":["InfrastBegin","InfrastEnterRotation"]},{"task_names":["InfrastBegin"],"foo":1},{}]:
   with self.assertRaisesRegex(RuntimeError,"fixed"):maa.validate_collection([{"type":"Custom","params":params}],self.root,self.profile)
 def test_changed_or_added_overlay_fails_closed(self):
  (self.tasks/"hotfix.json").write_text('{}',encoding="utf-8")
  with self.assertRaisesRegex(RuntimeError,"changed"):maa.validate_collection(self.plan,self.root,self.profile)
  (self.tasks/"hotfix.json").unlink();(self.tasks/"tasks.json").write_text('{}',encoding="utf-8")
  with self.assertRaisesRegex(RuntimeError,"changed"):maa.validate_collection(self.plan,self.root,self.profile)
 def test_order_independent_paths_but_not_content(self):
  self.assertEqual(maa.task_tree_digest(self.root),self.profile["taskTreeSha256"])
if __name__=="__main__":unittest.main()
