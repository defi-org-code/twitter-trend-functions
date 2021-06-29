import path from "path";
import fs from "fs-extra";
import fetch from "node-fetch";

const storage = path.resolve(process.env.HOME_DIR!!, "storage.json");

// handlers

async function _reader(event: any, context: any) {
  const param = event.pathParameters.param;
  console.log(`reader running with param = ${param}`);
  const { timestamp, writeIP } = await fs.readJson(storage);
  const readIP = (await fetchJson()).origin;
  return success({ param, timestamp: new Date(timestamp), writeIP, readIP, event, context });
}

async function _writer(event: any, context: any) {
  await fs.ensureFile(storage);
  const timestamp = new Date().getTime();
  const writeIP = (await fetchJson()).origin;
  await fs.writeJson(storage, { timestamp, writeIP });
  return success("OK");
}

// wrapper

function success(result: any) {
  return {
    statusCode: 200,
    body: JSON.stringify(result, null, 2),
  };
}

async function catchErrors(this: any, event: any, context: any) {
  try {
    return await this(event, context);
  } catch (err) {
    const message = err.stack || err.toString();
    console.error(message);
    return {
      statusCode: 500,
      body: message,
    };
  }
}

// example

async function fetchJson() {
  const response = await fetch("https://httpbin.org/gzip"); // some example JSON web service
  return await response.json();
}

// exports

export const reader = catchErrors.bind(_reader);
export const writer = catchErrors.bind(_writer);
