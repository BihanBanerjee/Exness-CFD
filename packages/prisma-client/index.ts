import { PrismaClient } from './generated/prisma/client';

// Export the Prisma client instance
export const prisma = new PrismaClient();

// Re-export all types from the generated Prisma client
export type {
  Asset,
  OrderType,
  OrderStatus,
} from './generated/prisma/enums';

// Re-export the PrismaClient type itself
export { PrismaClient } from './generated/prisma';
