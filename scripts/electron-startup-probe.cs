// Windows debugger: launches ONLY the selected QA executable with --version.
using System; using System.Text; using System.Runtime.InteropServices; using System.Diagnostics; using System.IO;
public class ElectronStartupProbe {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved,desktop,title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,res2; public IntPtr resptr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESSINFO { public IntPtr process,thread; public int pid,tid; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr p,IntPtr t,bool inherit,int flags,IntPtr env,string cwd,ref STARTUPINFO s,out PROCESSINFO i);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool WaitForDebugEvent(IntPtr e,int ms);
 [DllImport("kernel32.dll")] static extern bool ContinueDebugEvent(int p,int t,uint status);
 [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr p,IntPtr a,byte[] b,int n,out IntPtr read);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("dbghelp.dll",SetLastError=true)] static extern bool MiniDumpWriteDump(IntPtr p,int pid,IntPtr f,int type,IntPtr e,IntPtr u,IntPtr c);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenThread(int access,bool inherit,int tid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetThreadContext(IntPtr thread,IntPtr context);
 [DllImport("ntdll.dll")] static extern int NtQueryInformationThread(IntPtr thread,int cls,IntPtr info,int size,IntPtr ret);
 static void Registers(IntPtr process,int tid) { IntPtr th=OpenThread(0x48,false,tid), raw=Marshal.AllocHGlobal(1300); long aligned=(raw.ToInt64()+15)&~15L;IntPtr ctx=new IntPtr(aligned);try {for(int i=0;i<1232;i++)Marshal.WriteByte(ctx,i,0);Marshal.WriteInt32(ctx,48,0x100003);if(GetThreadContext(th,ctx))Console.WriteLine("EAX="+Marshal.ReadInt32(ctx,120)+" RSP=0x"+Marshal.ReadInt64(ctx,152).ToString("x"));IntPtr bi=Marshal.AllocHGlobal(48);try{if(NtQueryInformationThread(th,0,bi,48,IntPtr.Zero)==0){long teb=Marshal.ReadInt64(bi,8);byte[] b=new byte[4];IntPtr n;if(ReadProcessMemory(process,new IntPtr(teb+0x68),b,4,out n))Console.WriteLine("LastError="+BitConverter.ToInt32(b,0));}}finally{Marshal.FreeHGlobal(bi);}}finally{Marshal.FreeHGlobal(raw);CloseHandle(th);} }
 public static void Run(string exe,string cwd,string dump) {
  STARTUPINFO s=new STARTUPINFO();s.cb=Marshal.SizeOf(s);s.desktop="winsta0\\default";s.show=0;s.flags=1; PROCESSINFO p;
  if(!CreateProcess(exe,new StringBuilder("\""+exe+"\" --version"),IntPtr.Zero,IntPtr.Zero,false,2|0x08000000,IntPtr.Zero,cwd,ref s,out p))throw new Exception("CreateProcess "+Marshal.GetLastWin32Error());
  IntPtr e=Marshal.AllocHGlobal(176);int breaks=0;bool ended=false;
  try {for(int j=0;j<150;j++){
   if(!WaitForDebugEvent(e,1000))continue;int kind=Marshal.ReadInt32(e),pid=Marshal.ReadInt32(e,4),tid=Marshal.ReadInt32(e,8);uint status=0x00010002;
   if(kind==1){uint code=(uint)Marshal.ReadInt32(e,16);long addr=Marshal.ReadInt64(e,32);Console.WriteLine("Exception 0x"+code.ToString("x")+" address 0x"+addr.ToString("x")+" first="+Marshal.ReadInt32(e,168));if(code==0x80000003)breaks++;if(breaks>=2 || code==0xc0000005){Registers(p.process,tid);try{foreach(ProcessModule m in Process.GetProcessById(pid).Modules) if(addr>=m.BaseAddress.ToInt64()&&addr<m.BaseAddress.ToInt64()+m.ModuleMemorySize)Console.WriteLine("FAULT MODULE "+m.FileName+" offset 0x"+(addr-m.BaseAddress.ToInt64()).ToString("x"));}catch(Exception x){Console.WriteLine(x.Message);}using(FileStream f=File.Create(dump))Console.WriteLine("Dump "+MiniDumpWriteDump(p.process,pid,f.SafeFileHandle.DangerousGetHandle(),0,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero));} if(code!=0x80000003)status=0x80010001;}
   if(kind==8){long addr=Marshal.ReadInt64(e,16);short unicode=Marshal.ReadInt16(e,24),len=Marshal.ReadInt16(e,26);byte[] b=new byte[Math.Max(0,(int)len)*(unicode!=0?2:1)];IntPtr n;if(ReadProcessMemory(p.process,new IntPtr(addr),b,b.Length,out n))Console.WriteLine("DEBUG: "+(unicode!=0?Encoding.Unicode:Encoding.Default).GetString(b));}
   if(kind==3||kind==6){IntPtr h=Marshal.ReadIntPtr(e,16);if(h!=IntPtr.Zero)CloseHandle(h);}
   if(kind==5){Console.WriteLine("Exit 0x"+((uint)Marshal.ReadInt32(e,16)).ToString("x"));ended=true;}
   ContinueDebugEvent(pid,tid,status);if(ended)break;
  }}finally{Marshal.FreeHGlobal(e);CloseHandle(p.thread);CloseHandle(p.process);}
 }
}
