import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from '../src/core/app/app.module';

describe('App (e2e)', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;

  const suffix = Date.now();
  const userEmail = `e2e-user-${suffix}@test.com`;
  const userPassword = 'password2';

  // Один токен на всю цепочку сценариев — роли не кладутся в JWT
  // (см. Шаг 4/AuthService.login), поэтому один и тот же токен остаётся
  // рабочим и после SQL-промоции пользователя в admin.
  let userToken: string;

  beforeAll(async () => {
    initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { exposeUnsetFields: false },
      }),
    );

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/register -> 201, default role "user"', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: userEmail, password: userPassword })
      .expect(201);

    expect(response.body).toMatchObject({
      email: userEmail,
      roles: ['user'],
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('POST /auth/login -> 200 with correct credentials, 401 with wrong password', async () => {
    const okResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(200);

    expect(okResponse.body).toHaveProperty('accessToken');
    userToken = (okResponse.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: 'wrong-password' })
      .expect(401);
  });

  it('GET /admin/rbac/roles -> 401 without token, 403 with a non-admin token', async () => {
    await request(app.getHttpServer()).get('/admin/rbac/roles').expect(401);

    await request(app.getHttpServer())
      .get('/admin/rbac/roles')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('promoting the user to admin (raw SQL) grants access with the SAME token -> 200', async () => {
    await dataSource.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT u.id, r.id FROM users u, roles r
       WHERE u.email = $1 AND r.name = 'admin'`,
      [userEmail],
    );

    await request(app.getHttpServer())
      .get('/admin/rbac/roles')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
  });

  it('creating a grant takes effect immediately, without a restart', async () => {
    const roleName = `e2e-role-${suffix}`;
    const roleResponse = await request(app.getHttpServer())
      .post('/admin/rbac/roles')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: roleName })
      .expect(201);

    const otherEmail = `e2e-other-${suffix}@test.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherEmail, password: userPassword })
      .expect(201);

    await dataSource.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT u.id, r.id FROM users u, roles r
       WHERE u.email = $1 AND r.name = $2`,
      [otherEmail, roleName],
    );

    const otherLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherEmail, password: userPassword })
      .expect(200);
    const otherToken = (otherLogin.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .get('/admin/rbac/roles')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    const permissionRows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM permissions WHERE resource = 'rbac'`,
    );
    const permissionId = permissionRows[0].id;
    const roleId = (roleResponse.body as { id: string }).id;

    await request(app.getHttpServer())
      .post('/admin/rbac/grants')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ roleId, permissionId })
      .expect(201);

    await request(app.getHttpServer())
      .get('/admin/rbac/roles')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
  });
});
