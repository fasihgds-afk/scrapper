import dns from "node:dns";
import mongoose from "mongoose";
import { config } from "../config.js";

// Windows ISP DNS often breaks mongodb+srv SRV lookups (querySrv ECONNREFUSED).
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

export async function connectMongo(): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

export function isMongoReady(): boolean {
  return mongoose.connection.readyState === 1;
}
