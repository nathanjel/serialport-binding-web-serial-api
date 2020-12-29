import AbstractBinding from '@serialport/binding-abstract';
import SerialPort, { PortInfo } from 'serialport';

declare global {
  interface Navigator {
    readonly serial: unknown;
  }
}

export default class WSABinding extends AbstractBinding {
  private static internalBufferSize = 16384;
  private static internalNavigatorSerial: any = navigator.serial;
  private static backendAvailable: boolean = navigator.serial !== undefined;
  private static internalBasePortsList: [...any] = [];

  private storedOpenOptions: SerialPort.OpenOptions = {
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    rtscts: false,
  };
  private boundedPort: any | undefined = undefined;
  private actualBaudRate = -1;
  private classReader: ReadableStreamDefaultReader | undefined = undefined;
  private pendingRead: any | undefined = undefined;

  public static portFilters:
    | [{ usbVendorId: number; usbProductId?: number }]
    | undefined = undefined;
  public static debug = false;
  public isOpen = false;

  static list(): Promise<SerialPort.PortInfo[]> {
    return new Promise((resolve, reject) => {
      if (WSABinding.backendAvailable) {
        WSABinding.updatePortsList().then(() => {
          resolve(
            WSABinding.internalBasePortsList.map(
              WSABinding.mapBasePortToPortInfo,
            ),
          );
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

  private static internalLog(text: string) {
    if (WSABinding.debug)
      console.log('%c WSA Log: ' + text, 'background: #222; color: #bada55');
  }

  private static dec2hex16bitWithPad(i: number): string {
    return (i + 0x10000).toString(16).substr(-4).toUpperCase();
  }

  private static mapBasePortToPath(sourceSerialPort: any): string {
    const sourceInfo: any = sourceSerialPort.getInfo();
    return (
      'wsa://' +
      WSABinding.dec2hex16bitWithPad(sourceInfo.usbVendorId) +
      '-' +
      WSABinding.dec2hex16bitWithPad(sourceInfo.usbProductId)
    );
  }

  private static mapBasePortToPortInfo(sourceSerialPort: any): PortInfo {
    const sourceInfo: any = sourceSerialPort.getInfo();
    return {
      path: WSABinding.mapBasePortToPath(sourceSerialPort),
      productId: sourceInfo.usbProductId,
      vendorId: sourceInfo.usbVendorId,
    };
  }

  private static updatePortsList(): Promise<void> {
    return WSABinding.internalNavigatorSerial.getPorts().then((ports) => {
      if (ports.length > 0) {
        return new Promise((resolve) => {
          WSABinding.internalBasePortsList = ports;
          resolve(null);
        });
      } else {
        if (WSABinding.internalBasePortsList.length == 0) {
          return WSABinding.internalNavigatorSerial
            .requestPort({ filters: WSABinding.portFilters })
            .then((port) => {
              WSABinding.internalBasePortsList = [port];
              return new Promise((resolve) => {
                resolve(null);
              });
            });
        } else {
          return new Promise((resolve) => {
            resolve(null);
          });
        }
      }
    });
  }

  private static mapOpenOptions(input: SerialPort.OpenOptions): any {
    return {
      baudRate: input.baudRate,
      dataBits: input.dataBits,
      stopBits: input.stopBits,
      parity: input.parity,
      bufferSize: WSABinding.internalBufferSize,
      flowControl: input.rtscts ? 'hardware' : 'none',
    };
  }

  open(path: string, options: SerialPort.OpenOptions): Promise<void> {
    WSABinding.internalLog('open called, path: ' + path);
    this.classReader = undefined;
    return super.open(path, options).then(() => {
      return WSABinding.updatePortsList().then(() => {
        for (const port of WSABinding.internalBasePortsList) {
          const mappedName = WSABinding.mapBasePortToPath(port);
          WSABinding.internalLog('Checking ' + mappedName);
          if (mappedName == path || path == 'wsa://default') {
            this.boundedPort = port;
            const localOptions = this.storedOpenOptions;
            Object.assign(localOptions, options);
            return this.boundedPort
              .open(WSABinding.mapOpenOptions(localOptions))
              .then(
                () => {
                  WSABinding.internalLog('Open successful');
                  this.isOpen = true;
                  return new Promise((resolve) => {
                    WSABinding.internalLog('Open resolved');
                    resolve(null);
                  });
                },
                (failAny) => {
                  this.isOpen = false;
                  WSABinding.internalLog('Open failed');
                  return new Promise((reject) => {
                    WSABinding.internalLog('Open rejected with ' + failAny);
                    reject(null);
                  });
                },
              );
          }
        }
      });
    });
  }

  private closePromise(): Promise<void> {
    return this.boundedPort.close().then(() => {
      return new Promise((resolve) => {
        this.isOpen = false;
        resolve(null);
      });
    });
  }

  close(): Promise<void> {
    WSABinding.internalLog('close called');
    return super.close().then(() => {
      if (this.classReader) {
        this.classReader.cancel().then(() => {
          this.classReader.releaseLock();
          return this.closePromise();
        });
      } else {
        return this.closePromise();
      }
    });
  }

  write(buffer: Buffer): Promise<void> {
    WSABinding.internalLog('write called');
    const mWriter = this.boundedPort.writable.getWriter();
    return super.write(buffer).then(() => {
      return mWriter.write(buffer).then(() => {
        return new Promise((resolve) => {
          WSABinding.internalLog('Write system execution completed');
          mWriter.releaseLock();
          resolve(null);
        });
      });
    });
  }

  private registerInternalRead(): Promise<ReadableStreamReadResult<any>> {
    const internalRead = this.classReader.read();
    this.pendingRead = internalRead;
    return internalRead;
  }

  private clearInternalRead() {
    this.pendingRead = undefined;
  }

  read(
    buffer: Buffer,
    offset: number,
    length: number,
  ): Promise<{ bytesRead: number; buffer: Buffer }> {
    let internalOffset: number = offset;
    let internalBytesRead = 0;
    let callbackCounter = 0;
    const currentRef: WSABinding = this;

    WSABinding.internalLog('read called, bytes expecting: ' + length);
    const basePromise: Promise<any> = super.read(buffer, offset, length);

    function callReadAndPromise(): Promise<{
      bytesRead: number;
      buffer: Buffer;
    }> {
      WSABinding.internalLog(
        'Read system execution initiated ' + callbackCounter,
      );
      return currentRef.registerInternalRead().then((readStruct) => {
        WSABinding.internalLog(
          'Read system execution completed ' + callbackCounter,
        );
        currentRef.clearInternalRead();
        return internalPromise(readStruct);
      });
    }

    function internalPromise(readerObject: {
      value?: any;
      done: boolean;
    }): Promise<{ bytesRead: number; buffer: Buffer }> {
      return new Promise<{ bytesRead: number; buffer: Buffer }>((resolve) => {
        WSABinding.internalLog('Updating result buffer ' + callbackCounter);
        // const done = readerObject.done;
        if (readerObject.value) {
          // we ignore the "done" flag, as it seems never to
          // reach the point of being set, even when there is
          // no more data to read, the Web Serial Api will just block
          // if (!done) {
          const value: Uint8Array = readerObject.value;
          const step: number = value.length;
          WSABinding.internalLog('Read bytes: ' + step);
          // console.log(value);
          buffer.set(value, internalOffset);
          internalOffset += step;
          internalBytesRead += step;
          callbackCounter += 1;
          //  return callReadAndPromise();
          // } else {
          WSABinding.internalLog(
            'No more data, total callbacks: ' + callbackCounter,
          );
          WSABinding.internalLog('Returning bytes : ' + internalBytesRead);
          resolve({
            bytesRead: internalBytesRead,
            buffer: buffer,
          });
        } else {
          resolve({
            bytesRead: 0,
            buffer: buffer,
          });
        }
      });
    }

    if (this.boundedPort.readable) {
      if (this.classReader === undefined) {
        this.classReader = this.boundedPort.readable.getReader();
      }
      return basePromise.then(() => {
        return new Promise((resolve, reject) => {
          if (this.isOpen) {
            // WSABinding.internalLog("WTF??");
            callReadAndPromise().then(resolve, reject);
          } else {
            reject({
              canceled: true,
            });
          }
        });
      });
    } else {
      return basePromise.then(() => {
        return new Promise((reject) => {
          reject({
            bytesRead: 0,
            buffer: buffer,
          });
        });
      });
    }
  }

  update(options: { baudRate: number }): Promise<void> {
    WSABinding.internalLog('update called');
    return super.update(options).then(() => {
      return new Promise((reject) => {
        WSABinding.internalLog('update not supported');
        reject(null);
      });
    });
  }

  set(options: SerialPort.SetOptions): Promise<void> {
    WSABinding.internalLog('set called');
    return super.set(options).then(() => {
      return this.boundedPort.setSignals({
        dataTerminalReady: options.dtr,
        requestToSend: options.rts,
        break: options.brk,
      });
    });
  }

  // CTS, DSR, DCD
  get(): Promise<{
    cts: boolean;
    dsr: boolean;
    dcd: boolean;
  }> {
    WSABinding.internalLog('get called');
    return super.get().then(() => {
      this.boundedPort.getSignals().then((singalsInfoStructure) => {
        return new Promise((resolve, reject) => {
          if (singalsInfoStructure) {
            resolve({
              cts: singalsInfoStructure.clearToSend,
              dsr: singalsInfoStructure.dataSetReady,
              dcd: singalsInfoStructure.dataCarrierDetect,
            });
          } else {
            reject(null);
          }
        });
      });
    });
  }

  getBaudRate(): Promise<number> {
    WSABinding.internalLog('getBaudRate called');
    return new Promise((resolve) => {
      resolve(this.actualBaudRate);
    });
  }

  flush(): Promise<void> {
    WSABinding.internalLog('flush called');
    return super.flush().then(() => {
      return new Promise((reject) => {
        WSABinding.internalLog('flush not supported');
        reject(null);
      });
    });
  }

  drain(): Promise<void> {
    WSABinding.internalLog('drain called');
    return super.drain().then(() => {
      return new Promise((reject) => {
        WSABinding.internalLog('drain not supported');
        reject(null);
      });
    });
  }
}
