import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@property-ai/database';
import { z } from 'zod';
import { AppError } from '../../middlewares/error-handler.js';
import type { JwtPayload } from '@property-ai/shared';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export class AuthService {
  async login(body: unknown) {
    const { email, password } = loginSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError(401, 'Invalid credentials');

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) throw new AppError(401, 'Invalid credentials');

    const secret = process.env.JWT_SECRET!;
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, secret, { expiresIn: '7d' });

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }
}
