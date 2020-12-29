Web Serial API binding for [Node.js serialport](https://serialport.io/)

```ts
import SerialPort from '@serialport/stream';
import WSABinding from 'serialport-binding-web-serial-api';

SerialPort.Binding = WSABinding;

SerialPort.list().then(portsList => {
    console.log(JSON.stringify(portsList));
}, err => {
    console.error(JSON.stringify(err));
});
```

## Installation

This is a [Node.js](https://nodejs.org/en/) module available through the [npm registry](https://www.npmjs.com/).
Before installing, [download and install Node.js](https://nodejs.org/en/download/).
If this is a brand new project, make sure to create a `package.json` first with the [`npm init` command](https://docs.npmjs.com/creating-a-package-json-file).
Installation is done using the [`npm install` command](https://docs.npmjs.com/getting-started/installing-npm-packages-locally):

```bash
$ npm install serialport-binding-web-serial-api
```

As this module provides [Web Serial API](https://wicg.github.io/serial/) bindings for [node.js serialport](https://serialport.io/), applications using it will require `@serialport/stream` module installed as well. This is provided for You by Node.js dependency mechanism.

## Browser support

On 29th Dec 2020, Web Serial API is supported in modern Chromium based browsers, that is Chrome, Edge, Opera and of course Chromium.

### Special activities needed to enable Web Serial API support

  * Chromium based browsers require enabling **Experimental Web Platform Features**
  	Chrome & Chromium: `chrome://flags/#enable-experimental-web-platform-features`
	Opera: `opera://flags/#enable-experimental-web-platform-features`
	Edge: `edge://flags/#enable-experimental-web-platform-features`
  * On Linux, snap based Chromium installation requires connecting Chromium snap to USB mapped serial ports
    `sudo snap connect chromium:raw-usb`

## Features

  * Enables to use Node.js serialport module based apps in browser almost directly
  * Supports base read/write operations and setting/getting serial port flags
  * Supports USB Vendor & Product ID based port selection limitation

## Docs

Usage of Web Serial API is straightforward, as it does not expose new functionality, merely binds the well documented Node Serialport to the Web Serial API available in browsers. See the example below for usage and referenced documentation.

  * [Web Serial API](https://wicg.github.io/serial/) - Draft Communit Group Report, Web Serial API reference
  * [Node Serialport](https://serialport.io/) - Documentation for the Serialport module
  
### Issuses & Limitations

  * `update` command is not implemented, as there is no support in Web Serial API for baud rate change for open port
  * `flush` is not implemented, no specific function in Web Serial API; need to check if possible thru the underlying stream objects
  * `drain` is not implemented, no specific function in Web Serial API; need to check if possible thru the underlying stream objects or `write` function `Promise`
  * as of 1.0.0 release date, getPorts() in Web Serial API as implemented in Chromium does not return list of serial ports allowed by user, this means at every start of application user will have to select serial port in a popup shown by the browser
  * tested only in Chromium 87.0.4280.88
  * Web Serial API specification is a living document and it's implementation is experimental; things might break any moment

## Example

  This is a very simple TypeScript example of a browser serial terminal application using jQuery, Serialport and Web Serial API

```ts
// very simple serial terminal
import $ from 'jquery';
import './vendor';
import SerialPort from '@serialport/stream'; // Serial / UART access.
import WSABinding from './wsa-sp-bind';
import stripAnsi from 'strip-ansi';

// terminal settings
// does not echo
var term_speed = 115200;

// serial port binding to Web Serial API
SerialPort.Binding = WSABinding;

// construct simple webpage
var myPort = undefined;
var actref = $(document.createElement("button"));
var twinref = $(document.createElement("textarea"));
var bref = $("body");
bref.html('');
bref.append(actref);
bref.append(twinref);
bref.children().css("display", "block").css("font-family", "monospace");
twinref.prop( "disabled", true );
twinref.attr("rows", "24");
twinref.attr("cols", "80");
actref.text('Start serial terminal');
var ta = $('textarea');
window.setInterval(() => { 
    var tal = ta.val().length;
    ta.scrollTop(ta[0].scrollHeight);
    ta[0].setSelectionRange(tal, tal);
}, 100);

// handle terminal startup - must be user initiated!
actref.click(() => {
    myPort = new SerialPort('wsa://default', {
        baudRate: term_speed,
        autoOpen: true
    });
    myPort.on('data', data => {
        var sta = $('textarea');
        for(var i = 0; i<data.length; i++) {
            if (data[i] == 8) { // simplistic
                sta.val(sta.val().slice(0,-1));
            }
        }
        var re = /[\0-\x1F\x7F-\x9F\xAD]/;
        sta.val(sta.val() + stripAnsi(data.toString()).replace(re,''));
    });
    myPort.on('open', () => {
        twinref.prop( "disabled", false );
        $('textarea').focus();
    })
})

// handle terminal text input
function twrite(c:string) {
    myPort.write(c, err => {
        if (err) {
            console.log('Error on write: ', err.message);                    
        }
    });
}
twinref.on('keydown', e => {
    var tval = undefined;
    if (e.which == 13) {
        tval = "\r\n";
    } else if (e.which == 8) {
        tval = "\b";
    } else if (e.which == 9) {
        tval = "\t";
    } else {
        return;
    }
    twrite(tval);
    e.preventDefault();  
});
twinref.on('keyup', e => {
    e.preventDefault();
});
twinref.on('keypress', e => {
    twrite(String.fromCharCode(e.which));
    e.preventDefault();
});
```

## People

The original author is [Marcin Galczynski](https://github.com/nathanjel/)

## License

  [MIT](LICENSE)