import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FileTransformation } from './entities/file-transformation.entity';
import { FileTransformController } from './file-transform.controller';
import { FileTransformService } from './file-transform.service';
import { ResultStorageService } from './result-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([FileTransformation])],
  controllers: [FileTransformController],
  providers: [FileTransformService, ResultStorageService],
})
export class FileTransformModule {}
