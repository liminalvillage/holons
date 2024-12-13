import { Tenderly } from "@tenderly/sdk";
import * as dotenv from "dotenv";

dotenv.config();

const tenderly = new Tenderly({
  accessKey: process.env.TENDERLY_ACCESS_KEY || "",
  account: process.env.TENDERLY_ACCOUNT || "",
  project: process.env.TENDERLY_PROJECT || "",
});

export default tenderly;
