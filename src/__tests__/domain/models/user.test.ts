import {
  createCompositeMemberId,
  createCompositeMemberIdFromPersonName,
  createPersonName,
  parseGender,
} from '../../../domain/types';

describe('user domain model', () => {
  it('removes symbols and emoji from person names', () => {
    expect(createPersonName('Carla 🌞', 'Sommer✨')).toEqual({
      firstName: 'Carla',
      lastName: 'Sommer',
      fullName: 'Carla Sommer',
    });
  });

  it('creates stable composite member ids from first and last name', () => {
    expect(createCompositeMemberId('Ada', 'Lovelace')).toBe('ada::lovelace');
    expect(createCompositeMemberId('Jörg', 'Groß')).toBe('jorg::gross');
  });

  it('creates composite member ids from person names', () => {
    expect(createCompositeMemberIdFromPersonName(createPersonName('Max', 'Mustermann'))).toBe('max::mustermann');
    expect(createCompositeMemberIdFromPersonName(createPersonName('Carla 🌞', 'Sommer✨'))).toBe('carla::sommer');
  });

  it('accepts only supported gender values', () => {
    expect(parseGender('m')).toBe('m');
    expect(parseGender('W')).toBe('w');
    expect(() => parseGender('x')).toThrow('Unsupported gender: "x"');
  });
});