import { Injectable } from '@nestjs/common';
import { isValidDate, toDbDate, todayInKorea } from '../common/dates';
import { FORM_ERROR, FieldErrors, asBody, oneOf, optionalText, text } from '../common/validation';
import { ItemsService, serializeSanitization } from '../items/items.service';
import { PrismaService } from '../prisma/prisma.service';

const METHODS = ['STEAM', 'UV', 'WASH'] as const;
const RESULTS = ['PASS', 'FAIL'] as const;

@Injectable()
export class SanitizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemsService,
  ) {}

  // B7. 소독 기록 등록
  async create(itemId: number, rawBody: unknown) {
    const item = await this.items.getWithRentalsOr404(itemId);

    const body = asBody(rawBody);
    const errors = new FieldErrors();

    // 대여 중인 용품에 소독 기록이 생기면 "지금 상태" 계산이 어긋나므로 막습니다.
    if (item.rentals.some((rental) => rental.returnedAt === null)) {
      errors.add(FORM_ERROR, '아직 반납되지 않은 용품이에요. 반납 처리를 한 뒤 소독 기록을 남겨 주세요.');
    }

    const sanitizedAt = body.sanitizedAt;
    if (!isValidDate(sanitizedAt) || sanitizedAt > todayInKorea()) {
      errors.add('sanitizedAt', '소독한 날은 오늘이나 그 이전 날짜로 골라 주세요.');
    }

    const staffName = text(body.staffName);
    if (staffName.length < 2 || staffName.length > 20) {
      errors.add('staffName', '담당 직원 이름을 적어 주세요.');
    }

    const method = oneOf(body.method, METHODS);
    if (!method) errors.add('method', '소독 방법을 골라 주세요.');

    const result = oneOf(body.result, RESULTS);
    if (!result) errors.add('result', '소독 결과를 골라 주세요.');

    const memo = optionalText(body.memo);
    if (memo && memo.length > 200) errors.add('memo', '메모는 200자 이내로 적어 주세요.');
    errors.throwIfAny();

    const sanitization = await this.prisma.sanitization.create({
      data: {
        itemId,
        sanitizedAt: toDbDate(sanitizedAt as string),
        staffName,
        method: method!,
        result: result!,
        memo,
      },
    });
    return serializeSanitization(sanitization);
  }
}
