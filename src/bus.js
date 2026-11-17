// The operator console and the display window talk through a BroadcastChannel.
// It works between tabs/windows of the same browser, with no server and no internet.
import { CHANNEL } from './config.js';

export const bus = new BroadcastChannel(CHANNEL);
