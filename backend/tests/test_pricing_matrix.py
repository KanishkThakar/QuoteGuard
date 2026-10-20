"""Deterministic cross-product: smallest payable price that protects a margin.

Synthetic inputs; no upstream traffic. Assert economic inequalities rather than
copying the implementation's suggested-price expression.
"""
from decimal import Decimal as D, localcontext
import pytest
from quotes.pricing import calculate


@pytest.mark.parametrize('currency', ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SGD'])
@pytest.mark.parametrize('margin', ['0', '.01', '.3', '.75', '.9999'])
@pytest.mark.parametrize('fee,fixed', [('0', '0'), ('.029', '.30'), ('.15', '5.99'), ('.95', '.0001')])
@pytest.mark.parametrize('quantity,unit,rate', [('1', '.01', '.0001'), ('1.001', '7.125', '.01044'), ('40', '2500', '1'), ('2.5', '950.1245', '1.79'), ('100', '999.99', '.007'), ('.001', '1', '2')])
def test_minimal_price_protects_margin(currency, margin, fee, fixed, quantity, unit, rate):
    result = calculate([{'quantity': quantity, 'unit_cost': unit}], margin, fee, fixed, rate, currency)
    with localcontext() as ctx:
        ctx.prec = 50
        price = D(result['gross_price'])
        quantum = D('1') if currency == 'JPY' else D('.01')
        cost = D(quantity) * D(unit)
        net_billing = price * (1 - D(fee)) - D(fixed)
        previous_net_billing = (price - quantum) * (1 - D(fee)) - D(fixed)
        assert net_billing * (1 - D(margin)) >= cost * D(rate)
        assert previous_net_billing * (1 - D(margin)) < cost * D(rate)
        assert price % quantum == 0
        assert not result['needs_review']
        assert not result['negative_profit']
        assert D(result['margin']) >= D(margin)
