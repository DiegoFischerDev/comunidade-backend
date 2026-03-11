import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Admin';
  const whatsapp = process.env.ADMIN_WHATSAPP || '';

  if (!email || !password) {
    console.error(
      'Defina ADMIN_EMAIL e ADMIN_PASSWORD no seu .env antes de rodar este script.',
    );
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const updated = await prisma.user.update({
      where: { email: normalizedEmail },
      data: {
        role: Role.ADMIN,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    console.log(
      `Usuário existente com e-mail ${normalizedEmail} atualizado para ADMIN.`,
    );
    console.log(updated);
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      role: Role.ADMIN,
      name,
      whatsapp,
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  console.log('Usuário admin criado com sucesso:');
  console.log(user);
}

main()
  .catch((err) => {
    console.error('Erro ao criar usuário admin:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

