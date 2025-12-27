/**
 * Snapshot Manager
 * Handles snapshot creation, persistence, and recovery
 * Snapshots are taken every 15 seconds to enable fast recovery
 */
import type { StateSnapshot } from "@exness/redis-stream-types";
import type { StateManager } from "../state/StateManager";
import { prisma } from "@exness/prisma-client";
import type { Prisma } from "@exness/prisma-client/generated/prisma/client";

// Convert BigInt to string for JSON serialization

function serializeSnapshot(snapshot: StateSnapshot): any {
    return JSON.stringify(snapshot, (key, value) => 
        typeof value === "bigint" ? value.toString() : value
    );
}


// Convert string back to BigInt for deserialization
function deserializeSnapshot(data: any): StateSnapshot {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;

    // Recursively convert numeric strings back to BigInt
    const convertBigInts = (obj: any): any => {
        if(obj === null || obj === undefined) return obj;

        if(typeof obj === "object") {
            if(Array.isArray(obj)) {
                return obj.map(convertBigInts);   
            }

            const converted: any = {};
            for (const [key, value] of Object.entries(obj)) {
                // Convert fields ending with "Int" back to BigInt
                if (
                typeof value === "string" &&
                /^-?\d+$/.test(value) &&
                key.toLowerCase().endsWith("int")
                ) {
                converted[key] = BigInt(value);
                } else if (typeof value === "object") {
                converted[key] = convertBigInts(value);
                } else {
                converted[key] = value;
                }
            }
            return converted;
        }

        return obj;
    }
    return convertBigInts(parsed);
}







export class SnapshotManager {
    private snapshotInterval: number = 15000; // 15 seconds

    constructor(private state: StateManager) {}

    /**
     * Create and save a snapshot to the database.
     */

    async createSnapshot(lastStreamId: string): Promise<string> {
        const snapshotId = `snapshot_${Date.now()}`

        // Create snapshot from current state
        const snapshot = this.state.createSnapshot(snapshotId, lastStreamId);

        try {
            // Serialize and save to database
            const serialized = serializeSnapshot(snapshot);

            await prisma.snapshot.create({
                data: {
                    id: snapshotId,
                    timestamp: new Date(snapshot.timestamp),
                    lastStreamId: snapshot.lastStreamId,
                    data: serialized as unknown as Prisma.InputJsonValue
                }
            });

            console.log(
                `Snapshot created: ${snapshotId} | Stream ID: ${lastStreamId} | Users: ${Object.keys(snapshot.users).length} | Orders: ${Object.keys(snapshot.orders).length}`
            );

            // Clean up old snapshots (keep last 20)
            await this.cleanupOldSnapshots(20);

            return snapshotId;
        } catch (error) {
            console.error("Error creating snapshot:", error);
            throw error;
        }
    }

    /**
     * Load the latest snapshot from the database
     */
    async loadLatestSnapshot(): Promise<StateSnapshot | null> {
        try {
            const latestSnapshot = await prisma.snapshot.findFirst({
                orderBy: {
                    timestamp: "desc",
                },
            });

            if(!latestSnapshot) {
                console.log("No snapshots found in database");
                return null;
            }

            console.log(
                `Loading snapshot: ${latestSnapshot.id} from ${latestSnapshot.timestamp}`
            );

            const snapshot =  deserializeSnapshot(latestSnapshot.data);

            // Restore state from snapshot
            this.state.restoreFromSnapshot(snapshot);

            return snapshot;
        } catch (error) {
            console.error("Error loading snapshot:", error);
            throw error;
        }
    }


    /**
     * Load a specific snapshot by ID
     */
    async loadSnapshot(snapshotId: string): Promise<StateSnapshot | null> {
        try {
            const snapshotRecord = await prisma.snapshot.findUnique({
                where: { id: snapshotId },
            });

            if(!snapshotRecord) {
                console.log(`Snapshot ${snapshotId} not found`);
                return null;
            }

            const snapshot = deserializeSnapshot(snapshotRecord.data)
            this.state.restoreFromSnapshot(snapshot);
            return snapshot;
        } catch (error) {
            console.error(`Error loading snapshot ${snapshotId}:`, error);
            throw error;
        }
    }


    /**
     * Delete old snapshots, keeping only the most recent ones
     * @param keepCount 
     */
    private async cleanupOldSnapshots(keepCount: number = 20): Promise<void> {
        try {
            // Get all snapshots sorted by timestamp
            const allSnapshots = await prisma.snapshot.findMany({
                orderBy: {
                    timestamp: "desc",      
                },
                select: {
                    id: true,
                },
            });

            // Delete snapshots beyond the keep count
            if (allSnapshots.length > keepCount) {
                const toDelete = allSnapshots.slice(keepCount);
                const idsToDelete = toDelete.map((s) => s.id);

                await prisma.snapshot.deleteMany({
                    where: {
                        id: {
                            in: idsToDelete,
                        },
                    },
                });

                console.log(`Cleaned up ${idsToDelete.length} old snapshots`);
            }
        } catch (error) {
            console.error("Error cleaning up snapshots:", error);
        }
    }


    /**
     * Get snapshot statistics
     */
    async getStats(): Promise<{
        totalSnapshots: number;
        latestSnapshot: { id: string; timestamp: Date; lastStreamId: string } | null;
        oldestSnapshot: {id: string; timestamp: Date} | null;
    }> {
        const totalSnapshots = await prisma.snapshot.count();

        const latestSnapshot = await prisma.snapshot.findFirst({
            orderBy: { timestamp: "desc" },
            select: { id: true, timestamp: true, lastStreamId: true },
        });

        const oldestSnapshot = await prisma.snapshot.findFirst({
            orderBy: { "timestamp": "asc" },
            select: { id: true, timestamp: true },
        });

        return {
            totalSnapshots,
            latestSnapshot,
            oldestSnapshot
        };
    }

    /**
     * Start periodic snapshot creation
     */
    startPeriodicSnapshots(
        getCurrentStreamId: () => string,
        interval: number = this.snapshotInterval
    ): NodeJS.Timeout {
        console.log(`Starting periodic snapshots every ${interval}ms`);

        const timer = setInterval(async () => {
            try {
                const currentStreamId = getCurrentStreamId();
                await this.createSnapshot(currentStreamId);
            } catch (error) {
                console.error("Error in periodic snapshot:", error);
                
            }
        }, interval)

        return timer;
    }

    /**
     * Stop periodic snapshots
     */
    stopPeriodicSnapshots(timer: NodeJS.Timeout): void {
        clearInterval(timer);
        console.log("Stopped periodic snapshots");
    }
}