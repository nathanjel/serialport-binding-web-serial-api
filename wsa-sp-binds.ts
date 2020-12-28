import AbstractBinding from '@serialport/binding-abstract';
import { strict } from 'assert';
import SerialPort, { PortInfo } from 'serialport';

declare global {
  interface Navigator {
    readonly serial: unknown;
  }
}

const internalBufferSize: number = 16384;
const internalNavigatorSerial: any = navigator.serial;
const backendAvailable: boolean = navigator.serial !== undefined;
let internalBasePortsList: [...any] = [];

function internalLog(text: string) {
  // console.log("%c WSA Log: " + text, 'background: #222; color: #bada55');
}

function dec2hex16bitWithPad(i: number): string {
  return (i + 0x10000).toString(16).substr(-4).toUpperCase();
}

function mapBasePortToPath(sourceSerialPort: any): string {
  const sourceInfo: any = sourceSerialPort.getInfo();
  return 'wsa://' + dec2hex16bitWithPad(sourceInfo.usbVendorId) + '-' + dec2hex16bitWithPad(sourceInfo.usbProductId);
}

function mapBasePortToPortInfo(sourceSerialPort: any): PortInfo {
  const sourceInfo: any = sourceSerialPort.getInfo();
  return {
    path: mapBasePortToPath(sourceSerialPort),
    productId: sourceInfo.usbProductId,
    vendorId: sourceInfo.usbVendorId
  };
}

function updatePortsList(): Promise<void> {
  let tPromise = new Promise(resolve => {
    resolve(internalBasePortsList.length == 0 ? null : internalBasePortsList[0]);
  });
  if (internalBasePortsList.length == 0) {
    tPromise = internalNavigatorSerial.requestPort();
  }
  return tPromise.then(port => {
    internalBasePortsList = [port];
    return internalNavigatorSerial.getPorts();
  }).then(ports => {
    return new Promise(resolve => {
      if (ports.length > 0) {
        internalBasePortsList = ports;
      }
      resolve(null);
    });
  });
}

function mapOpenOptions(input: SerialPort.OpenOptions): any {
  return {
    baudRate: input.baudRate,
    dataBits: input.dataBits,
    stopBits: input.stopBits,
    parity: input.parity,
    bufferSize: internalBufferSize,
    flowControl: input.rtscts ? "hardware" : "none"
  }
}

export default class WSABinding extends AbstractBinding {
  private storedOpenOptions: SerialPort.OpenOptions = {
    baudRate : 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    rtscts: false
  };
  private boundedPort: any | undefined = undefined;
  private actualBaudRate: number = -1;
  private classReader:ReadableStreamDefaultReader | undefined = undefined;
  private pendingRead:any|undefined = undefined;

  public isOpen: boolean = false;

  static list(): Promise<SerialPort.PortInfo[]> {
    return new Promise((resolve, reject) => {
      if (backendAvailable) {
        updatePortsList().then(res => {
          resolve(internalBasePortsList.map(mapBasePortToPortInfo))
        });
      } else {
        reject();
      }
    });
  }

  constructor(opt: SerialPort.OpenOptions) {
    super(opt);
    Object.assign(this.storedOpenOptions, opt);
  }

  open(path: string, options: SerialPort.OpenOptions): Promise<void> {
    internalLog("Open called for " + path);
    this.classReader = undefined;
    return super.open(path, options).then(ok => {
      return updatePortsList().then(ports => {
        for(var port of internalBasePortsList) {
          const mappedName = mapBasePortToPath(port);
          internalLog("Checking " + mappedName);
          if (mappedName == path) {
            this.boundedPort = port;
            let localOptions = this.storedOpenOptions;
            Object.assign(localOptions, options);
            return this.boundedPort.open(mapOpenOptions(localOptions)).then(okVoid => {
              internalLog("Open successful");
              this.isOpen = true;
              return new Promise(resolve => {
                internalLog("Open resolved");
                resolve(null);
              });
            }, failAny => {
              this.isOpen = false;
              internalLog("Open failed");
              return new Promise(reject => {
                internalLog("Open rejected with " + failAny);
                reject(null);
              })
            });
          }
        }
      });
    });
  }

  closePromise(): Promise<void> {
    return this.boundedPort.close().then(res => {
      return new Promise(resolve => {
        this.isOpen = false;
        resolve(null);
      });
    });
  }

  close(): Promise<void> {
    internalLog("Close called");
    return super.close().then(ok => {
      if (this.classReader) {
        this.classReader.cancel().then(ok => {
          this.classReader.releaseLock();
          return this.closePromise();        
        });
      } else {
        return this.closePromise();
      }
    });
  }

  write(buffer: Buffer): Promise<void> {
    internalLog("Write called");
    const mWriter = this.boundedPort.writable.getWriter();
    return super.write(buffer).then(ok => {
      return mWriter.write(buffer).then(res => {
        return new Promise(resolve => {
          internalLog("Write system execution completed");
          mWriter.releaseLock();
          resolve(null);
        });
      });
    });
  }

  registerInternalRead(): Promise<ReadableStreamReadResult<any>> {
    let internalRead = this.classReader.read();
    this.pendingRead = internalRead;
    return internalRead;
  }

  clearInternalRead() {
    this.pendingRead = undefined;
  }

  read(buffer: Buffer, offset: number, length: number): Promise<{ bytesRead: number, buffer: Buffer }> {
    let internalOffset:number = offset;
    let internalBytesRead: number = 0;
    let callbackCounter: number = 0;
    let currentRef:WSABinding = this;

    internalLog("Read called, expecting maximum so many bytes: " + length);
    const basePromise:Promise<any> = super.read(buffer, offset, length);

    internalLog("Super promise requested");

    function callReadAndPromise(): Promise<{ bytesRead: number, buffer: Buffer }> {
      internalLog("Read system execution initiated " + callbackCounter);
      return currentRef.registerInternalRead().then(readStruct => {
        internalLog("Read system execution completed " + callbackCounter);
        currentRef.clearInternalRead();
        return internalPromise(readStruct);
      });
    }

    function internalPromise(readerObject: { value?: any, done: boolean }) : Promise<{ bytesRead: number, buffer: Buffer }> {
      return new Promise<{ bytesRead: number, buffer: Buffer }>((resolve, reject) => {        
        internalLog("Updating result buffer " + callbackCounter);
        const done = readerObject.done;
        if (readerObject.value) {
        // we ignore the "done" flag, as it seems never to
        // reach the point of being set, even when there is
        // no more data to read, the Web Serial Api will just block
        // if (!done) {
          const value:Uint8Array = readerObject.value;
          const step: number = value.length;
          internalLog("Read bytes: " + step);
          // console.log(value);
          buffer.set(value, internalOffset);
          internalOffset += step;
          internalBytesRead += step;
          callbackCounter += 1;
        //  return callReadAndPromise();
        // } else {
          internalLog("No more data, total callbacks: " + callbackCounter);
          internalLog("Returning bytes : " + internalBytesRead);
          resolve({
            bytesRead: internalBytesRead,
            buffer: buffer
          });
        }
      });
    }
    
    if (this.boundedPort.readable) {
      if (this.classReader === undefined) {
        this.classReader = this.boundedPort.readable.getReader();
      }
      return basePromise.then(ok => {
        return new Promise((resolve, reject) => {
          if (this.isOpen) {
            // internalLog("WTF??");
            callReadAndPromise().then(resolve, reject);
          } else {        
            reject({
              canceled:true
            });
          }
        });
      });
    } else {
      return basePromise.then(ok => {
        return new Promise(reject => {
          reject({
            bytesRead: 0,
            buffer: buffer
          });
        });
      });
    }
  }

  update(options: { baudRate: number }): Promise<void> {
    internalLog("Update called");
    return super.update(options).then(ok => {
      return new Promise(reject => {
        reject(null);
      });
    });
  }

  set(options: SerialPort.SetOptions): Promise<void> {
    internalLog("Set called");
    return super.set(options).then(ok => {
      return this.boundedPort.setSignals({
        dataTerminalReady: options.dtr,
        requestToSend: options.rts,
        break: options.brk
      });
    });
  }

  // CTS, DSR, DCD
  get(): Promise<{
    cts: boolean;
    dsr: boolean;
    dcd: boolean;
    }> {
    internalLog("Get called");
    return super.get().then(ok => {
      this.boundedPort.getSignals().then(sis => {
        return new Promise((resolve, reject) => {
          if (sis) {
            resolve({
              cts: sis.clearToSend,
              dsr: sis.dataSetReady,
              dcd: sis.dataCarrierDetect
            });
          } else {
            reject(null);
          }
        });
      });
    });
  }

  getBaudRate(): Promise<number> {
    return new Promise(resolve => {
      resolve(this.actualBaudRate);
    })
  }

  flush(): Promise<void> {
    internalLog("Flush called");
    return super.flush().then(ok => {
      return new Promise(reject => {
        internalLog("Flush not supported");
        reject(null);
      });
    });
  }

  drain(): Promise<void> {
    internalLog("Drain called");
    return super.drain().then(ok => {
      return this.boundedPort.writable.close();
    });
  }
}
