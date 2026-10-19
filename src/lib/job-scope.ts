import type { Prisma } from '@prisma/client';

/** The jobs that one user may see: the feed jobs, and the jobs that this user pasted. Another user's pasted job is not in it. */
export const visibleTo = (userId: string): Prisma.JobWhereInput => ({ OR: [{ pastedBy: null }, { pastedBy: userId }] });
