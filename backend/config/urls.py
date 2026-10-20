from django.urls import path, include
from rest_framework.routers import DefaultRouter
from quotes.views import ClientView, QuoteView, auth, lab, health

router = DefaultRouter()
router.register("clients", ClientView, basename="client")
router.register("quotes", QuoteView, basename="quote")
urlpatterns = [
    path("api/auth/<str:verb>/", auth),
    path("api/health/", health),
    path("api/lab/", lab),
    path("api/", include(router.urls)),
]
