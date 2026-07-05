/**
 * IncomeStep.test.tsx — M2 (2026-07-05 exhaustive audit)
 *
 * Onboarding's monthly-income field used to parse with a local `toCents`
 * (`parseFloat(str.replace(',', '.'))`), silently mis-parsing grouped income
 * (e.g. "25,000" -> R25.00 instead of R25,000) and cascading a wrong figure
 * into the whole generated budget. It now uses the locale-safe
 * `parseMoneyInput`.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { IncomeStep } from '../IncomeStep';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: (): object => ({ navigate: mockNavigate }),
}));

const mockSetMonthlyIncomeCents = jest.fn();
jest.mock('../../../../stores/appStore', () => ({
  useAppStore: Object.assign(jest.fn(), {
    getState: (): object => ({ setMonthlyIncomeCents: mockSetMonthlyIncomeCents }),
  }),
}));

function wrap(el: React.ReactElement): React.ReactElement {
  return <PaperProvider>{el}</PaperProvider>;
}

describe('IncomeStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the income input', () => {
    const { getByTestId } = render(wrap(<IncomeStep />));
    expect(getByTestId('income-amount-input')).toBeTruthy();
  });

  it('accepts a thousands-separated income and stores the correct cents', async () => {
    const { getByTestId } = render(wrap(<IncomeStep />));
    fireEvent.changeText(getByTestId('income-amount-input'), '25,000');
    fireEvent.press(getByTestId('onboarding-cta'));

    await waitFor(() => {
      expect(mockSetMonthlyIncomeCents).toHaveBeenCalledWith(2_500_000);
    });
    expect(mockNavigate).toHaveBeenCalledWith('ExpenseCategories');
  });

  it('accepts a comma-decimal income and stores the correct cents', async () => {
    const { getByTestId } = render(wrap(<IncomeStep />));
    fireEvent.changeText(getByTestId('income-amount-input'), '25000,50');
    fireEvent.press(getByTestId('onboarding-cta'));

    await waitFor(() => {
      expect(mockSetMonthlyIncomeCents).toHaveBeenCalledWith(2_500_050);
    });
  });

  it('rejects a pasted, malformed-grouping amount with an inline error and does not proceed', async () => {
    const { getByTestId, getByText } = render(wrap(<IncomeStep />));
    fireEvent.changeText(getByTestId('income-amount-input'), '1,00,000');
    fireEvent.press(getByTestId('onboarding-cta'));

    await waitFor(() => {
      expect(getByText(/valid amount/i)).toBeTruthy();
    });
    expect(mockSetMonthlyIncomeCents).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('rejects empty input with an inline error and does not proceed', async () => {
    const { getByTestId, getByText } = render(wrap(<IncomeStep />));
    fireEvent.press(getByTestId('onboarding-cta'));

    await waitFor(() => {
      expect(getByText(/enter an amount/i)).toBeTruthy();
    });
    expect(mockSetMonthlyIncomeCents).not.toHaveBeenCalled();
  });
});
