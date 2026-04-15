import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { AllocateEnvelopesStep } from '../AllocateEnvelopesStep';

const mockExecute = jest.fn().mockResolvedValue({ success: true, data: { id: 'env-x' } });
jest.mock('../../../../../domain/envelopes/CreateEnvelopeUseCase', () => ({
  CreateEnvelopeUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: (): object => ({ navigate: mockNavigate }),
  useRoute: (): object => ({ params: { categories: ['Groceries', 'Rent', 'Transport'] } }),
}));

jest.mock('../../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../../data/audit/AuditLogger', () => ({ AuditLogger: jest.fn() }));

jest.mock('../../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    jest.fn((selector: (s: object) => unknown) =>
      selector({
        householdId: 'hh-test',
        paydayDay: 25,
        monthlyIncomeCents: 3_000_000, // R30 000
      }),
    ),
    {
      getState: (): object => ({
        monthlyIncomeCents: 3_000_000,
        householdId: 'hh-test',
        paydayDay: 25,
      }),
    },
  ),
}));

function wrap(el: React.ReactElement): React.ReactElement {
  return <PaperProvider>{el}</PaperProvider>;
}

describe('AllocateEnvelopesStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('equal-splits income across categories on first render', () => {
    const { getByTestId } = render(wrap(<AllocateEnvelopesStep />));
    // R30 000 / 3 categories = R10 000 each
    expect(getByTestId('alloc-input-Groceries').props.value).toBe('10000.00');
    expect(getByTestId('alloc-input-Rent').props.value).toBe('10000.00');
    expect(getByTestId('alloc-input-Transport').props.value).toBe('10000.00');
  });

  it('updates To Assign banner as user nudges allocations', () => {
    const { getByTestId } = render(wrap(<AllocateEnvelopesStep />));
    fireEvent.changeText(getByTestId('alloc-input-Groceries'), '15000');
    expect(getByTestId('to-assign').props.children).toContain('-5');
  });

  it('creates one envelope per category with its allocation on Next', async () => {
    const { getByText } = render(wrap(<AllocateEnvelopesStep />));
    fireEvent.press(getByText('Next'));
    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });
    expect(mockNavigate).toHaveBeenCalledWith('Payday');
  });

  it('blocks Next when To Assign is not zero', async () => {
    const { getByTestId, getByText, queryByText } = render(wrap(<AllocateEnvelopesStep />));
    fireEvent.changeText(getByTestId('alloc-input-Groceries'), '20000');
    fireEvent.press(getByText('Next'));
    await waitFor(() => {
      expect(queryByText(/Your allocations must total/i)).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
