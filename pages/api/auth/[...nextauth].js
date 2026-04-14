// pages/api/auth/[...nextauth].js
// NextAuth.js credentials provider backed by Neon users table.
//
// Required env vars:
//   NEXTAUTH_SECRET  — generate with: openssl rand -base64 32
//   NEXTAUTH_URL     — e.g. https://randysucksgolfleague.vercel.app
//   DATABASE_URL     — Neon connection string (already set)
//
// Env vars that can be removed after deploy:
//   LEAGUE_SECRET, COMMISSIONER_NAME

import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { sql, ensureTable } from '../../../lib/db';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        await ensureTable();
        const rows = await sql`
          SELECT id, name, email, password_hash, is_commissioner
          FROM users
          WHERE email = ${credentials.email.toLowerCase().trim()}
          LIMIT 1
        `;

        if (!rows.length) return null;

        const user = rows[0];
        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;

        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          isCommissioner: user.is_commissioner,
        };
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
        token.isCommissioner = user.isCommissioner;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.name = token.name;
        session.user.email = token.email;
        session.user.isCommissioner = token.isCommissioner;
      }
      return session;
    },
  },

  pages: {
    signIn: '/',
  },
};

export default NextAuth(authOptions);
