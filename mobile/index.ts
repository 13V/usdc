// Polyfills MUST load before anything that touches @solana/web3.js or tweetnacl:
// react-native-get-random-values provides crypto.getRandomValues (keypair gen),
// and buffer provides the global Buffer used by web3.js / bs58.
import "react-native-get-random-values";
import { Buffer } from "buffer";
// @ts-ignore — install Buffer on the global.
if (typeof global.Buffer === "undefined") global.Buffer = Buffer;

import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
