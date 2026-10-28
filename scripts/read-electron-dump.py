import sys
sys.path.insert(0,'external/diagnostics/python-lib')
import pefile,capstone
pe=pefile.PE('node_modules/electron/dist/electron.exe');rva=0x2a53ada
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True
start=rva-160
for i in md.disasm(pe.get_data(start,200),start): print(hex(i.address),i.mnemonic,i.op_str)
from minidump.minidumpfile import MinidumpFile
m=MinidumpFile.parse('artifacts/verification/electron-startup.dmp')
print(m.threads)
print(m.modules)
