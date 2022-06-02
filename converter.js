"use strict";

const { createApp } = Vue

/** Convert a number (0-255) to a 2 character hex string */
function byteToHex(data) {
    const nibbleToHex = '0123456789ABCDEF';
    return nibbleToHex[Math.floor(data / 16) & 0xf] + nibbleToHex[Math.floor(data & 0xf)];
}

function hexStringToBytes(text) {
    let trimmed = text.replace(/\s/g, "");
    if (/[^a-fA-F0-9]/.test(trimmed)) {
      throw new Error('Hex string can only contain 0-9 A-F');
    }
    if (trimmed.length % 2 != 0) {
      throw new Error('Hex string length without spaces must be multiple of 2');
    }
    let hexBytes = [];
    for (let i=0; i < trimmed.length; i+=2) {
        let hexChar = trimmed.slice(i, i+2);
        hexBytes.push(parseInt(hexChar, 16));
    }
    return new Uint8Array(hexBytes);
}

/** Decode an Uint8Array with UTF-8 encoded text to a string. Throw an exception if the data is invalid. */
function bytesToText(byteArray) {
    // create an URI string with all bytes %-encoded
    let uri = '';
    for (let i=0; i < byteArray.length; i++) {
        uri += '%' + byteToHex(byteArray[i]);
    }
    // use decodeURIComponent to convert to text and validate correctness
    return decodeURIComponent(uri);
}

/** Convert a string to a list of Unicode code points */
function textToCodePoints(text) {
    // Javascript strings are stored in UTF-16, so one Unicode codepoint takes 1 or 2 characters in a string
    let codePoints = []
    for (let i = 0; i < text.length; i++) {
        let thisCode = text.codePointAt(i);
        codePoints.push(thisCode);
        // string.codePointAt() recognizes correctly surrogate pairs, but the index
        // is in string characters, so we must do an extra increment if this is one
        // takes 2 characters
        if (thisCode >= 65536) {
            i++;
        }
    }
    return codePoints;
}

// Functions for conversion from TypedArray to Base64: https://developer.mozilla.org/en-US/docs/Glossary/Base64

/** Decode one character of a Base64 string to its 6-bit value */
function b64ToUint6 (nChr) {
  return nChr > 64 && nChr < 91 ?
      nChr - 65
    : nChr > 96 && nChr < 123 ?
      nChr - 71
    : nChr > 47 && nChr < 58 ?
      nChr + 4
    : nChr === 43 ?
      62
    : nChr === 47 ?
      63
    :
      0;
}

/** Decode an ASCII Base64 string to Uint8Array*/
function base64DecToArr (sBase64, nBlocksSize) {
  let sB64Enc = sBase64.trim();
  if (/[^A-Za-z0-9\+\/=]/.test(sB64Enc)) {
      throw new Error("base64-string contains invalid characters");
  }
  if (/=[^\=]/.test(sB64Enc)) {
      throw new Error("base64-string can only have = at end of string");
  }
  sB64Enc = sB64Enc.replace(/=/g,"");
  let nInLen = sB64Enc.length;
  let nOutLen = nBlocksSize ? Math.ceil((nInLen * 3 + 1 >> 2) / nBlocksSize) * nBlocksSize : nInLen * 3 + 1 >> 2
  let taBytes = new Uint8Array(nOutLen);

  for (let nMod3, nMod4, nUint24 = 0, nOutIdx = 0, nInIdx = 0; nInIdx < nInLen; nInIdx++) {
    nMod4 = nInIdx & 3;
    nUint24 |= b64ToUint6(sB64Enc.charCodeAt(nInIdx)) << 6 * (3 - nMod4);
    if (nMod4 === 3 || nInLen - nInIdx === 1) {
      for (nMod3 = 0; nMod3 < 3 && nOutIdx < nOutLen; nMod3++, nOutIdx++) {
        taBytes[nOutIdx] = nUint24 >>> (16 >>> nMod3 & 24) & 255;
      }
      nUint24 = 0;
    }
  }

  return taBytes;
}

/** Encode a value 0-63 to its corresponding Base64 character */
function uint6ToB64 (nUint6) {
  // Order: A-Z a-z 0-9 + /
  return nUint6 < 26 ?
      nUint6 + 65
    : nUint6 < 52 ?
      nUint6 + 71
    : nUint6 < 62 ?
      nUint6 - 4
    : nUint6 === 62 ?
      43
    : nUint6 === 63 ?
      47
    :
      65;
}

/** Encode an Uint8Buffer to a base64 encoded string */
function base64EncArr (aBytes) {
  let nMod3 = 2;
  let sB64Enc = "";

  for (let nLen = aBytes.length, nUint24 = 0, nIdx = 0; nIdx < nLen; nIdx++) {
    nMod3 = nIdx % 3;
    if (nIdx > 0 && (nIdx * 4 / 3) % 76 === 0) { sB64Enc += "\r\n"; }
    nUint24 |= aBytes[nIdx] << (16 >>> nMod3 & 24);
    if (nMod3 === 2 || aBytes.length - nIdx === 1) {
      sB64Enc += String.fromCodePoint(uint6ToB64(nUint24 >>> 18 & 63), uint6ToB64(nUint24 >>> 12 & 63), uint6ToB64(nUint24 >>> 6 & 63), uint6ToB64(nUint24 & 63));
      nUint24 = 0;
    }
  }

  return sB64Enc.slice(0, sB64Enc.length - 2 + nMod3) + (nMod3 === 2 ? '' : nMod3 === 1 ? '=' : '==');
}

createApp({
data() {
    return {
        inputType: 'text',
        inputString: '€',

        rawBytes : new Uint8Array(),
        rawText : '',
        codePoints: [],

        bytesValid: true,
        textValid: true,
        errorMessage: '',
    }
},
computed: {
    base64Bytes() {
        return base64EncArr(this.rawBytes);
    },
    hexBytes() {
        let hexString = '';
        for (let i=0; i < this.rawBytes.length; i++) {
            hexString += byteToHex(this.rawBytes[i]) + ' ';
        }
        // remove last space (also valid if empty string)
        return hexString.slice(0, -1);
    },
    uriEncoded() {
        return encodeURIComponent(this.rawText);
    },
    unicode() {
        let result = '';
        for (let i=0; i < this.codePoints.length; i++) {
            result += 'U+' + ("000000" + this.codePoints[i].toString(16)).slice(-6) + ' ';
        }
        return result.slice(0, -1);
    }
},
methods: {
    /** Convert a text to byteBuffer */
    updateBytesWithText(value) {
        let encoder = new TextEncoder();
        this.rawBytes = encoder.encode(value);
    },
    update(inputType, inputString) {
        this.rawBytes = new Uint8Array();
        this.rawText = '';
        this.codePoints = [];
        this.bytesValid = false;
        this.textValid = false;
        this.errorMessage = "Unknown error";

        try {
            if (inputType == 'text') {
                this.updateBytesWithText(inputString);
                this.bytesValid = true;
            } else if (inputType == 'uri') {
                this.updateBytesWithText(decodeURIComponent(inputString));
                this.bytesValid = true;
            } else if (inputType == 'hex') {
                this.rawBytes = hexStringToBytes(inputString);
                this.bytesValid = true;
            } else if (inputType == 'base64') {
                this.rawBytes = base64DecToArr(inputString, 1);
                this.bytesValid = true;
            }
        } catch(e) { 
            if (e instanceof Error) {
                this.errorMessage = e.message;
            }
        }
        if (this.bytesValid) {
            try {
                this.rawText = bytesToText(this.rawBytes);
                this.textValid = true;
            } catch(e) {}
        }
        if (this.textValid) {
            this.codePoints = textToCodePoints(this.rawText);
        }
    }
},
watch: {
    inputString: {
        handler(newValue, oldValue) {
          this.update(this.inputType, newValue);
        },
        immediate: true
    },
    inputType(newValue, oldValue) { this.update(newValue, this.inputString); }
}
}).mount('#app')
