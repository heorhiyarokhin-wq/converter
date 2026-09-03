import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: string } => {
    const request = ctx
      .switchToHttp()
      .getRequest<FastifyRequest & { user: { id: string } }>();

    return request.user;
  },
);
