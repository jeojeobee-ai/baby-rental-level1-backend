import { Injectable, NotFoundException } from '@nestjs/common';
import { Item, Prisma, Rental, Sanitization } from '@prisma/client';
import { fromDbDate } from '../common/dates';
import { FieldErrors, asBody, intInRange, oneOf, optionalText, text } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { computeItemStatus } from './item-status';

export const ITEM_NOT_FOUND = '찾는 용품이 없어요';

const CATEGORIES = ['MOBILITY', 'SLEEP', 'FEEDING', 'PLAY'] as const;
const CONDITIONS = ['GOOD', 'FAIR', 'NEEDS_REPAIR'] as const;
const CODE_PATTERN = /^[A-Z]{3}-\d{3}$/;

type ItemWithRecords = Item & { rentals: Rental[]; sanitizations: Sanitization[] };

// 최신순: 날짜가 늦은 것 먼저, 같은 날이면 나중에 기록한 것 먼저
const newestRentalsFirst: Prisma.RentalOrderByWithRelationInput[] = [
  { rentedAt: 'desc' },
  { createdAt: 'desc' },
];
const newestSanitizationsFirst: Prisma.SanitizationOrderByWithRelationInput[] = [
  { sanitizedAt: 'desc' },
  { createdAt: 'desc' },
];

export function serializeRental(rental: Rental) {
  return {
    id: rental.id,
    itemId: rental.itemId,
    guardianName: rental.guardianName,
    guardianPhone: rental.guardianPhone,
    childAgeMonths: rental.childAgeMonths,
    rentedAt: fromDbDate(rental.rentedAt),
    dueDate: fromDbDate(rental.dueDate),
    returnedAt: fromDbDate(rental.returnedAt),
    createdAt: rental.createdAt,
  };
}

export function serializeSanitization(sanitization: Sanitization) {
  return {
    id: sanitization.id,
    itemId: sanitization.itemId,
    sanitizedAt: fromDbDate(sanitization.sanitizedAt),
    staffName: sanitization.staffName,
    method: sanitization.method,
    result: sanitization.result,
    memo: sanitization.memo,
    createdAt: sanitization.createdAt,
  };
}

function serializeItem(item: ItemWithRecords) {
  const latestSanitization = item.sanitizations[0];
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category,
    minAgeMonths: item.minAgeMonths,
    maxAgeMonths: item.maxAgeMonths,
    condition: item.condition,
    memo: item.memo,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    status: computeItemStatus(item.condition, item.rentals, item.sanitizations),
    lastSanitizedAt: latestSanitization ? fromDbDate(latestSanitization.sanitizedAt) : null,
  };
}

@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  // B2. 용품 목록
  async findAll() {
    const items = await this.prisma.item.findMany({
      orderBy: { code: 'asc' },
      include: {
        rentals: { orderBy: newestRentalsFirst },
        sanitizations: { orderBy: newestSanitizationsFirst },
      },
    });
    return items.map(serializeItem);
  }

  // B3. 용품 상세
  async findOne(id: number) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: {
        rentals: { orderBy: newestRentalsFirst },
        sanitizations: { orderBy: newestSanitizationsFirst },
      },
    });
    if (!item) throw new NotFoundException({ message: ITEM_NOT_FOUND });
    return {
      ...serializeItem(item),
      rentals: item.rentals.map(serializeRental),
      sanitizations: item.sanitizations.map(serializeSanitization),
    };
  }

  // B4. 용품 등록
  async create(rawBody: unknown) {
    const body = asBody(rawBody);
    const errors = new FieldErrors();

    const code = text(body.code).toUpperCase();
    if (code === '') errors.add('code', '관리 번호를 적어 주세요.');
    else if (!CODE_PATTERN.test(code)) errors.add('code', '관리 번호는 MOV-001처럼 적어 주세요.');

    const name = text(body.name);
    if (name.length < 1 || name.length > 30) errors.add('name', '용품 이름을 30자 이내로 적어 주세요.');

    const category = oneOf(body.category, CATEGORIES);
    if (!category) errors.add('category', '분류를 골라 주세요.');

    const ageMessage = '월령은 0부터 72 사이 숫자로 적어 주세요.';
    const minAgeMonths = intInRange(body.minAgeMonths, 0, 72);
    if (minAgeMonths === null) errors.add('minAgeMonths', ageMessage);
    const maxAgeMonths = intInRange(body.maxAgeMonths, 0, 72);
    if (maxAgeMonths === null) errors.add('maxAgeMonths', ageMessage);
    if (minAgeMonths !== null && maxAgeMonths !== null && minAgeMonths > maxAgeMonths) {
      errors.add('maxAgeMonths', '사용 시작 월령이 끝 월령보다 클 수 없어요.');
    }

    const condition = oneOf(body.condition, CONDITIONS);
    if (!condition) errors.add('condition', '용품 상태를 골라 주세요.');

    const memo = optionalText(body.memo);
    if (memo && memo.length > 200) errors.add('memo', '메모는 200자 이내로 적어 주세요.');

    const duplicateMessage = '이미 등록된 관리 번호예요. 다른 번호를 적어 주세요.';
    if (!errors.has('code') && (await this.prisma.item.findUnique({ where: { code } }))) {
      errors.add('code', duplicateMessage);
    }
    errors.throwIfAny();

    try {
      const item = await this.prisma.item.create({
        data: {
          code,
          name,
          category: category!,
          minAgeMonths: minAgeMonths!,
          maxAgeMonths: maxAgeMonths!,
          condition: condition!,
          memo,
        },
      });
      return this.findOne(item.id);
    } catch (error) {
      // 두 사람이 같은 번호를 동시에 등록한 경우
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = new FieldErrors();
        duplicate.add('code', duplicateMessage);
        duplicate.throwIfAny();
      }
      throw error;
    }
  }

  // 대여·소독 기록을 남기기 전에 용품이 있는지 확인합니다.
  async getWithRentalsOr404(id: number) {
    const item = await this.prisma.item.findUnique({ where: { id }, include: { rentals: true } });
    if (!item) throw new NotFoundException({ message: ITEM_NOT_FOUND });
    return item;
  }
}
