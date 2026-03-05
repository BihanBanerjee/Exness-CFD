import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "@exness/prisma-client";
import redisClient from "@exness/redis-client";
import { engineClient } from "../services/engineClient";

const generateToken = (userId: string) => {
    return jwt.sign({userId}, process.env.JWT_SECRET!, {expiresIn: "1d"}); // Here ! is a non-null assertion operator. It tells TS that this value is not null or undefined, trust me.
}

const setAuthCookie = (res: Response, token: string) => {
    res.cookie(
        "token", token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    )
}

export const signup = async (req: Request, res: Response) => {
    try {
        // Validation is handled by Zod middleware
        const { email, phone, password } = req.body;

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                email,
                phone,
                password: hashedPassword,
            }
        })

        // Register user in liquidation engine with initial dummy balance (1000 USD)
        const INITIAL_BALANCE = 100000000000n // 1000.00000000 * 10^8
        try {
            const response  = await engineClient.registerUser(newUser.id, INITIAL_BALANCE);

            if(!response.success) {
                // Rollback user creation if engine registration fails
                await prisma.user.delete({
                    where: {
                        id: newUser.id
                    }
                });
                return res.status(500).json({
                    error: "Failed to initialize user in liquidation engine"
                })
            }

        } catch (error) {
            // Rollback user creation if engine communication fails
            await prisma.user.delete({
                where: {
                    id: newUser.id
                }  
            })
            return res.status(500).json({
                error: "Failed to communicate with trading engine"
            });
        }

        const token = generateToken(newUser.id);
        setAuthCookie(res, token);

        return res.json({
            message: "User registered successfully",
            user: {
                id: newUser.id,
                email: newUser.email,
            }
        })
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Internal server error. Failed to register user"
        })
    }
}

export const signin = async (req: Request, res: Response) => {
    try {
        // Validation is handled by Zod middleware
        const {email, password} = req.body;

        const user = await prisma.user.findUnique({
            where: {
                email
            }
        })

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if(!isPasswordValid) {
            return res.status(400).json({
                message: "Invalid credentials"
            });
        }

        const token = generateToken(user.id);
        setAuthCookie(res, token);

        return res.json({
            message: "Login Successful",
            user: {
                id: user.id,
                email: user.email
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Internal server error. Failed to login user"
        })
    }
}

export const getWsTicket = async (req: Request, res: Response) => {
    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
        const ticket = crypto.randomUUID();
        // Store ticket in Redis: key = ws:ticket:<ticket>, value = userId, TTL = 30 seconds
        await redisClient.set(`ws:ticket:${ticket}`, decoded.userId, "EX", 30);
        return res.json({ ticket });
    } catch {
        return res.status(401).json({ error: "Invalid token" });
    }
}

export const signout = async (req: Request, res: Response) => {
    res.clearCookie(
        "token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
        }
    )
    return res.json({
        message: "Logout successful"
    })
}