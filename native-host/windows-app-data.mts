// Windows Package Identity と ApplicationData の OS API。インストール先や PFN から
// アプリデータのパスを組み立てず、Windows が返すフォルダをアプリとホストで共有する。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WindowsPackageData {
  familyName: string;
  localState: string;
  localCache: string;
  tempState: string;
}

function loadKoffi() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const base of [import.meta.url, path.join(here, '..', 'app', 'package.json'), path.join(here, '..', 'app.asar', 'package.json'), path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'package.json')]) {
    const require = createRequire(base);
    let resolved: string;
    try {
      resolved = require.resolve('koffi');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    return require(resolved);
  }
  throw new Error('Windows アプリデータの取得に必要な koffi が見つかりません');
}

// COM の GUID は Windows SDK / Microsoft windows-rs の ABI 定義に従う。
// https://github.com/microsoft/windows-rs/blob/master/crates/libs/windows/src/Windows/Storage/mod.rs
function guid(value: string): Buffer {
  const parts = value.split('-');
  const result = Buffer.alloc(16);
  result.writeUInt32LE(parseInt(parts[0], 16), 0);
  result.writeUInt16LE(parseInt(parts[1], 16), 4);
  result.writeUInt16LE(parseInt(parts[2], 16), 6);
  Buffer.from(parts[3] + parts[4], 'hex').copy(result, 8);
  return result;
}

let cached: WindowsPackageData | null | undefined;
export function getWindowsPackageData(): WindowsPackageData | null {
  if (process.platform !== 'win32') return null;
  if (cached !== undefined) return cached;
  const koffi = loadKoffi();
  const kernel = koffi.load('kernel32.dll');
  const getFamilyName = kernel.func('long __stdcall GetCurrentPackageFamilyName(_Inout_ uint32_t *length, void *name)');
  const length = [0];
  const status = getFamilyName(length, null);
  if (status === 15700) return (cached = null); // APPMODEL_ERROR_NO_PACKAGE
  if (status !== 122 || length[0] < 1 || length[0] > 32768) throw new Error(`GetCurrentPackageFamilyName: ${status}`);
  const name = Buffer.alloc(length[0] * 2);
  const readStatus = getFamilyName(length, name);
  if (readStatus !== 0) throw new Error(`GetCurrentPackageFamilyName: ${readStatus}`);
  const familyName = name.toString('utf16le').replace(/\0.*$/s, '');

  const winrt = koffi.load('combase.dll');
  const initialize = winrt.func('long __stdcall RoInitialize(uint32_t type)');
  const uninitialize = winrt.func('void __stdcall RoUninitialize()');
  const createString = winrt.func('long __stdcall WindowsCreateString(str16 source, uint32_t length, _Out_ void **value)');
  const deleteString = winrt.func('long __stdcall WindowsDeleteString(void *value)');
  const stringBuffer = winrt.func('void * __stdcall WindowsGetStringRawBuffer(void *value, _Out_ uint32_t *length)');
  const activation = winrt.func('long __stdcall RoGetActivationFactory(void *name, const void *iid, _Out_ void **result)');
  const pointerSize = koffi.sizeof('void *');
  const check = (hr: number, operation: string) => {
    if (hr < 0) throw new Error(`${operation}: HRESULT 0x${(hr >>> 0).toString(16)}`);
  };
  const call = (object: any, slot: number, result: string, arguments_: string[], ...args: any[]) => {
    const table = koffi.decode(object, 'void *');
    const method = koffi.decode(table, slot * pointerSize, 'void *');
    return koffi.call(method, koffi.proto('__stdcall', result, ['void *', ...arguments_.map((type) => (type.startsWith('_Out_ ') ? koffi.out(type.slice(6)) : type))]), object, ...args);
  };
  const release = (object: any) => {
    if (object != null) call(object, 2, 'uint32_t', []);
  };
  const query = (object: any, iid: string) => {
    const out = [null];
    check(call(object, 0, 'long', ['const void *', '_Out_ void **'], guid(iid), out), 'QueryInterface');
    return out[0];
  };
  const property = (object: any, slot: number) => {
    const out = [null];
    check(call(object, slot, 'long', ['_Out_ void **'], out), 'ApplicationData property');
    return out[0];
  };
  const folderPath = (object: any, slot: number): string => {
    const folder = property(object, slot);
    let item: any;
    let value: any;
    try {
      item = query(folder, '4207a996-ca2f-42f7-bde8-8b10457a7f30'); // IStorageItem
      value = property(item, 12); // IStorageItem.Path
      const size = [0];
      const raw = stringBuffer(value, size);
      // Electron は外部 ArrayBuffer を許可しないため、ネイティブ領域をコピーして読む。
      const folderValue = koffi.decode.string16(raw, size[0]);
      if (!path.win32.isAbsolute(folderValue)) throw new Error('Windows が絶対パス以外のアプリデータフォルダを返しました');
      return folderValue;
    } finally {
      if (value != null) deleteString(value);
      release(item);
      release(folder);
    }
  };
  const initialized = initialize(1); // RO_INIT_MULTITHREADED
  // Electron が別の COM apartment を初期化済みでも、その apartment で呼び出せる。
  if (initialized >>> 0 !== 0x80010106) check(initialized, 'RoInitialize');
  let className: any;
  let factory: any;
  let data: any;
  let data2: any;
  try {
    const text = 'Windows.Storage.ApplicationData';
    const classOut = [null];
    check(createString(text, text.length, classOut), 'WindowsCreateString');
    className = classOut[0];
    const out = [null];
    check(activation(className, guid('5612147b-e843-45e3-94d8-06169e3c8e17'), out), 'RoGetActivationFactory');
    factory = out[0];
    data = property(factory, 6); // IApplicationDataStatics.Current
    data2 = query(data, '9e65cd69-0ba3-4e32-be29-b02de6607638'); // IApplicationData2
    cached = { familyName, localState: folderPath(data, 12), localCache: folderPath(data2, 6), tempState: folderPath(data, 14) };
    return cached;
  } finally {
    release(data2);
    release(data);
    release(factory);
    if (className != null) deleteString(className);
    if (initialized >= 0) uninitialize();
  }
}
