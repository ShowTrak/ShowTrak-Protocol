'use strict';
// Synthetic, validator-clean telemetry for one simulated Windows show PC, shaped
// like what ShowTrak Client 3.28.x sends (see client/run.js samplePayloads for a
// real capture) and checked against ShowTrakServer src/Modules/SocketValidation.
// Deterministic per client index so every run sends the same bytes.
const crypto = require('crypto');

// sha256(JSON.stringify([])): the deployment fingerprint of an empty script
// catalog (ScriptManager.BuildDeploymentFingerprint on both sides), i.e. what a
// client that has applied the (empty) deployment reports.
const EMPTY_SCRIPTS_FINGERPRINT = crypto.createHash('sha256').update('[]').digest('hex');

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
const pad = (n, w = 3) => String(n).padStart(w, '0');
const hex2 = (n) => (n & 255).toString(16).padStart(2, '0');

function macFor(i, nic) {
  return ['00', '1a', '2b', hex2(nic), hex2(i >> 8), hex2(i)].join(':');
}

const BASE_APPS = [
  ['Resolume Arena', 1],
  ['QLab', 1],
  ['Google Chrome', 14],
  ['Microsoft Edge', 6],
  ['Companion', 2],
  ['TouchDesigner', 1],
  ['OBS Studio', 1],
  ['Dante Controller', 1],
  ['Dante Virtual Soundcard', 1],
  ['NVIDIA Control Panel', 1],
  ['Task Manager', 1],
  ['Notepad', 2],
  ['File Explorer', 1],
  ['Microsoft Teams', 4],
  ['Slack', 3],
  ['Spotify', 2],
  ['VLC media player', 1],
  ['Windows Terminal', 1],
  ['Visual Studio Code', 6],
  ['TeamViewer', 2],
  ['AnyDesk', 1],
  ['Steam', 3],
  ['Discord', 4],
  ['Logitech G HUB', 2],
  ['Elgato Stream Deck', 1],
  ['Bitfocus Companion', 1],
  ['ProPresenter', 1],
  ['vMix', 1],
  ['NDI Studio Monitor', 1],
  ['NDI Access Manager', 1],
  ['Snipping Tool', 1],
  ['Settings', 1],
  ['Calculator', 1],
  ['Paint', 1],
  ['Adobe Acrobat', 1],
];
const OPTIONAL_APPS = [
  'Photos',
  'Media Player',
  'Zoom',
  'Outlook',
  'Word',
  'Excel',
  'PowerPoint',
  'OneDrive',
];

class ClientPayloads {
  constructor(index, { version = '3.28.2' } = {}) {
    this.i = index;
    this.version = version;
    this.r = rng(index * 2654435761);
    this.bootAt = Date.now() - Math.floor(3600e3 + this.r() * 86400e3 * 3);
    this.ramTotal = 34359738368; // 32 GiB
    this.cpu = 5 + this.r() * 20;
    this.apps = BASE_APPS.map(([Name, Count]) => ({ Name, Count, Responding: true }));
    this.foreground = 'Resolume Arena';
    this.ipv4 = `10.20.${(index >> 8) & 255}.${index & 255 || 1}`;
  }
  heartbeat() {
    this.cpu = Math.max(0.5, Math.min(99, this.cpu + (this.r() - 0.5) * 6));
    const used = Math.floor(this.ramTotal * (0.35 + this.r() * 0.05));
    const up = Math.floor((Date.now() - this.bootAt) / 1000);
    const h = Math.floor(up / 3600);
    const m = Math.floor((up % 3600) / 60);
    const s = up % 60;
    return {
      Version: this.version,
      Vitals: {
        CPU: { UsagePercentage: Number(this.cpu.toFixed(2)) },
        Ram: {
          Total: this.ramTotal,
          Used: used,
          UsagePercentage: ((used / this.ramTotal) * 100).toFixed(2),
        },
        Uptime: { Formatted: `${h}:${pad(m, 2)}:${pad(s, 2)}`, Seconds: up },
      },
      ScriptsFingerprint: EMPTY_SCRIPTS_FINGERPRINT,
    };
  }
  systemInfo() {
    return {
      Hostname: `SHOW-PC-${pad(this.i)}`,
      OperatingSystem: 'Windows',
      MacAddresses: {
        Ethernet: {
          ipv4: this.ipv4,
          ipv6: `fe80::21a:2bff:fe00:${(this.i & 0xffff).toString(16)}`,
          mac: macFor(this.i, 1),
        },
        'Ethernet 2': {
          ipv4: `192.168.10.${(this.i % 250) + 2}`,
          ipv6: null,
          mac: macFor(this.i, 2),
        },
        'Wi-Fi': { ipv4: null, ipv6: null, mac: macFor(this.i, 3) },
      },
    };
  }
  usbDeviceList() {
    const dev = (VendorID, ProductID, ManufacturerName, ProductName, port, serial) => ({
      VendorID,
      ProductID,
      ManufacturerName,
      ProductName,
      SerialNumber: serial ? `${serial}${pad(this.i, 4)}` : null,
      Location: `1-${port}`,
      FirmwareVersion: '1.00',
      DeviceState: { ErrorCode: 0, Message: null },
    });
    return [
      dev(1133, 49271, 'Logitech', 'USB Receiver', '1', null),
      dev(1133, 50475, 'Logitech', 'USB Keyboard', '2', null),
      dev(4057, 96, 'Elgato', 'Stream Deck XL', '3.1', 'CL1'),
      dev(1891, 8193, 'Focusrite', 'Scarlett 2i2 USB', '3.2', 'Y8B'),
      dev(1155, 22336, 'STMicroelectronics', 'Virtual COM Port', '4', 'ST'),
      dev(2385, 5733, 'Kingston', 'DataTraveler 3.0', '5', 'KT'),
    ];
  }
  displayList() {
    const d = (n, w, h, x, primary) => ({
      SessionID: '1',
      ScreenNumber: n,
      DisplayID: `win:DEL41A${n}:${pad(this.i, 4)}${n}`,
      HardwareID: `win:DEL41A${n}:${pad(this.i, 4)}${n}`,
      IsStableIdentity: true,
      IdentitySource: 'edid',
      Label: `DELL U2720Q (${n})`,
      Width: w,
      Height: h,
      ScaleFactor: 1,
      RefreshRate: 60,
      Rotation: 0,
      Internal: false,
      Primary: primary,
      Bounds: { x, y: 0, width: w, height: h },
    });
    return [d(1, 1920, 1080, 0, true), d(2, 3840, 2160, 1920, false)];
  }
  networkInterfaces() {
    const v4 = (address, mac, prefix = 24) => ({
      family: 'IPv4',
      address,
      netmask: '255.255.255.0',
      cidr: `${address}/${prefix}`,
      mac,
      internal: false,
      scopeid: null,
    });
    const v6 = (address, mac, scopeid) => ({
      family: 'IPv6',
      address,
      netmask: 'ffff:ffff:ffff:ffff::',
      cidr: `${address}/64`,
      mac,
      internal: false,
      scopeid,
    });
    const m1 = macFor(this.i, 1).toUpperCase();
    const m2 = macFor(this.i, 2).toUpperCase();
    return [
      {
        name: 'Ethernet',
        addresses: [
          v4(this.ipv4, m1),
          v6(`fe80::21a:2bff:fe00:${(this.i & 0xffff).toString(16)}`, m1, 11),
        ],
        gateway: '10.20.0.1',
      },
      {
        name: 'Ethernet 2',
        addresses: [v4(`192.168.10.${(this.i % 250) + 2}`, m2)],
        gateway: null,
      },
      {
        name: 'Loopback Pseudo-Interface 1',
        addresses: [
          {
            family: 'IPv4',
            address: '127.0.0.1',
            netmask: '255.0.0.0',
            cidr: '127.0.0.1/8',
            mac: '00:00:00:00:00:00',
            internal: true,
            scopeid: null,
          },
          {
            family: 'IPv6',
            address: '::1',
            netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
            cidr: '::1/128',
            mac: '00:00:00:00:00:00',
            internal: true,
            scopeid: 0,
          },
        ],
        gateway: null,
      },
    ];
  }
  // --- running applications (ProcessMonitor) ------------------------------
  // Mutates the list with probability p; returns { changed, delta }.
  sampleApps(p) {
    if (this.r() >= p) return { changed: false };
    const before = new Map(this.apps.map((a) => [a.Name, { ...a }]));
    const roll = this.r();
    if (roll < 0.5) {
      // a multi-process app gained/lost a process (browser tab, etc.)
      const multi = this.apps.filter((a) => a.Count > 1);
      const a = multi[Math.floor(this.r() * multi.length)];
      a.Count = Math.max(1, a.Count + (this.r() < 0.5 ? -1 : 1));
    } else if (roll < 0.8) {
      // an optional app started or quit
      const name = OPTIONAL_APPS[Math.floor(this.r() * OPTIONAL_APPS.length)];
      const idx = this.apps.findIndex((a) => a.Name === name);
      if (idx >= 0) this.apps.splice(idx, 1);
      else this.apps.push({ Name: name, Count: 1, Responding: true });
    } else {
      // focus moved
      const pick = this.apps[Math.floor(this.r() * this.apps.length)];
      this.foreground = pick.Name;
    }
    const after = new Map(this.apps.map((a) => [a.Name, a]));
    const Started = [];
    const Changed = [];
    const Stopped = [];
    for (const [k, v] of after) {
      const b = before.get(k);
      if (!b) Started.push({ ...v });
      else if (b.Count !== v.Count || b.Responding !== v.Responding) Changed.push({ ...v });
    }
    for (const k of before.keys()) if (!after.has(k)) Stopped.push(k);
    return { changed: true, delta: { Started, Stopped, Changed } };
  }
  sortedApps() {
    return this.apps
      .slice()
      .sort((a, b) => (b.Count !== a.Count ? b.Count - a.Count : a.Name.localeCompare(b.Name)))
      .slice(0, 64);
  }
  appsCommon() {
    return {
      SampledAt: Date.now(),
      TotalCount: this.apps.length,
      Truncated: this.apps.length > 64,
      Status: { State: 'ok', Message: null, Platform: 'win32' },
      Foreground: this.foreground,
      Capabilities: { Responding: true, Foreground: true },
    };
  }
  runningApplicationsFull() {
    const c = this.appsCommon();
    return {
      SampledAt: c.SampledAt,
      TotalCount: c.TotalCount,
      Truncated: c.Truncated,
      Items: this.sortedApps(),
      Status: c.Status,
      Foreground: c.Foreground,
      Capabilities: c.Capabilities,
    };
  }
  runningApplicationsKeepalive() {
    const c = this.appsCommon();
    return {
      SampledAt: c.SampledAt,
      TotalCount: c.TotalCount,
      Truncated: c.Truncated,
      Items: [],
      Status: c.Status,
      NoChanges: true,
      Foreground: c.Foreground,
      Capabilities: c.Capabilities,
    };
  }
  applicationDelta(delta) {
    const c = this.appsCommon();
    return {
      Started: delta.Started,
      Stopped: delta.Stopped,
      Changed: delta.Changed,
      SampledAt: c.SampledAt,
      TotalCount: c.TotalCount,
      Truncated: c.Truncated,
      Status: c.Status,
      Foreground: c.Foreground,
      Capabilities: c.Capabilities,
    };
  }
  // --- 3.27+/3.28 monitors ------------------------------------------------
  audioDevices() {
    const ep = (dir, name, man, transport, ch, rate, def, vol, muted) => ({
      EndpointID: `wasapi:${dir}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      Direction: dir,
      Name: name,
      Manufacturer: man,
      Transport: transport,
      Channels: ch,
      SampleRate: rate,
      IsDefault: def,
      Volume: vol,
      Muted: muted,
    });
    return {
      SampledAt: Date.now(),
      Endpoints: [
        ep(
          'output',
          'Speakers (Focusrite USB Audio)',
          'Focusrite',
          'usb',
          2,
          48000,
          true,
          80,
          false
        ),
        ep(
          'input',
          'Analogue 1 + 2 (Focusrite USB Audio)',
          'Focusrite',
          'usb',
          2,
          48000,
          true,
          100,
          false
        ),
        ep(
          'output',
          'DVS Transmit 1-2 (Dante Virtual Soundcard)',
          'Audinate',
          'virtual',
          2,
          48000,
          false,
          100,
          false
        ),
        ep(
          'input',
          'DVS Receive 1-2 (Dante Virtual Soundcard)',
          'Audinate',
          'virtual',
          2,
          48000,
          false,
          100,
          false
        ),
        ep(
          'output',
          'DELL U2720Q (NVIDIA High Definition Audio)',
          'NVIDIA',
          'hdmi',
          2,
          48000,
          false,
          100,
          false
        ),
        ep(
          'output',
          'Realtek Digital Output (Realtek(R) Audio)',
          'Realtek',
          'builtin',
          2,
          48000,
          false,
          100,
          false
        ),
      ],
      Status: { State: 'ok', Message: null, Platform: 'win32', Backend: 'wasapi' },
      Capabilities: {
        DefaultDevice: true,
        Channels: true,
        SampleRate: true,
        Transport: true,
        InputVolume: 'endpoint',
        OutputVolume: 'endpoint',
        InputMute: 'endpoint',
        OutputMute: 'endpoint',
      },
    };
  }
  powerStatus() {
    return {
      SampledAt: Date.now(),
      Status: { State: 'ok', Message: null, Platform: 'win32', Backend: 'wmi' },
      Battery: null,
      OnBattery: false,
      LastSuspendAt: null,
      LastResumeAt: null,
    };
  }
  temperatures() {
    return {
      SampledAt: Date.now(),
      Status: { State: 'ok', Message: null, Platform: 'win32', Backend: 'wmi' },
      Sensors: [
        { Name: 'CPU Package', Kind: 'cpu', Celsius: Math.round(45 + this.r() * 10) },
        { Name: 'ACPI Thermal Zone', Kind: 'system', Celsius: Math.round(38 + this.r() * 5) },
      ],
      ThermalState: null,
    };
  }
  storageVolumes() {
    return {
      SampledAt: Date.now(),
      Status: { State: 'ok', Message: null, Platform: 'win32', Backend: 'storage' },
      Volumes: [
        {
          MountPoint: 'C:\\',
          Name: 'Windows',
          FileSystem: 'NTFS',
          Kind: 'internal',
          TotalBytes: 1000202039296,
          FreeBytes: 412345678848,
          ReadOnly: false,
          Health: 'ok',
        },
        {
          MountPoint: 'D:\\',
          Name: 'Media',
          FileSystem: 'NTFS',
          Kind: 'internal',
          TotalBytes: 2000398934016,
          FreeBytes: 1123456789504,
          ReadOnly: false,
          Health: 'ok',
        },
      ],
    };
  }
}

module.exports = { ClientPayloads, EMPTY_SCRIPTS_FINGERPRINT };
