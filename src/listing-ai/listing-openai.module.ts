import { Module } from '@nestjs/common';
import { HouseListingOpenAiService } from './house-listing-openai.service';

@Module({
  providers: [HouseListingOpenAiService],
  exports: [HouseListingOpenAiService],
})
export class ListingOpenAiModule {}
