import sys,struct
sys.path.insert(0,'external/diagnostics/python-lib')
import pefile,capstone
pe=pefile.PE('node_modules/electron/dist/electron.exe',fast_load=True)
print('literal',pe.get_data(0x2a53aa4+0x9236f17,300))
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
for start,size in [(0x2a50e20,150),(0x2a53070,150),(0x4a16dc0,180)]:
 print('FUNCTION',hex(start))
 for i in md.disasm(pe.get_data(start,size),start):print(hex(i.address),i.mnemonic,i.op_str)
