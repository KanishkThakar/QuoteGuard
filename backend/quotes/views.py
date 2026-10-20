import csv, io, json, copy, time
from datetime import timedelta
from decimal import Decimal
from html import escape
from django.contrib.auth import authenticate, login, logout, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect
from django.db import transaction, connection, IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from .models import Client, Quote, CostItem, AuditEvent
from .serializers import (
    ClientSerializer,
    QuoteSerializer,
    CalculationRequestSerializer,
    ScenarioRequestSerializer,
    LabRequestSerializer,
    PlanRequestSerializer,
)
from .services import evaluate, changed, CalculationConflict
from .rates import RateError, lookup, key
from .pricing import MINOR
from . import cache


@csrf_protect
def auth(request, verb):
    if request.method == "GET" and verb == "session":
        return JsonResponse(
            {
                "user": {"id": request.user.id, "username": request.user.username}
                if request.user.is_authenticated
                else None,
                "csrf": get_token(request),
                "currencies": list(MINOR),
            }
        )
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    try:
        data = json.loads(request.body)
    except ValueError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    if not isinstance(data, dict):
        return JsonResponse({"detail": "Send a JSON object."}, status=400)
    if verb in ["login", "register"] and (
        not isinstance(data.get("username"), str)
        or not isinstance(data.get("password"), str)
    ):
        return JsonResponse(
            {"detail": "Username and password must be text."}, status=400
        )
    if verb == "logout":
        logout(request)
        return JsonResponse({"ok": True})
    if verb == "register":
        username = str(data.get("username", "")).strip()
        if not username or len(username) > 150:
            return JsonResponse(
                {"detail": "Choose a username up to 150 characters."}, status=400
            )
        user = get_user_model()(username=username)
        try:
            from django.contrib.auth.validators import UnicodeUsernameValidator

            UnicodeUsernameValidator()(username)
        except DjangoValidationError as e:
            return JsonResponse({"detail": " ".join(e.messages)}, status=400)
        try:
            validate_password(data.get("password", ""), user)
        except DjangoValidationError as e:
            return JsonResponse({"detail": " ".join(e.messages)}, status=400)
        if get_user_model().objects.filter(username=username).exists():
            return JsonResponse({"detail": "Username already exists."}, status=400)
        user.set_password(data["password"])
        try:
            with transaction.atomic():
                user.save()
        except IntegrityError:
            return JsonResponse({"detail": "Username already exists."}, status=400)
        login(request, user)
    elif verb == "login":
        user = authenticate(
            request, username=data.get("username"), password=data.get("password")
        )
        if user is None:
            return JsonResponse({"detail": "Invalid credentials."}, status=400)
        login(request, user)
    else:
        return JsonResponse({"detail": "Unknown action."}, status=404)
    return JsonResponse(
        {"user": {"id": user.id, "username": user.username}, "csrf": get_token(request)}
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    with connection.cursor() as c:
        c.execute("SELECT 1")
    try:
        cache.connection().ping()
        r = True
    except Exception:
        r = False
    return Response(
        {"database": "ok", "redis": "ok" if r else "unavailable", "application": "ok"}
    )


class ClientView(viewsets.ModelViewSet):
    lookup_value_regex = r"\d+"
    serializer_class = ClientSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return Client.objects.filter(owner=self.request.user).order_by("name")

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_destroy(self, instance):
        if Quote.objects.filter(client=instance).exists():
            raise ValidationError(
                "Client is referenced by a quotation; keep it for provenance."
            )
        instance.delete()


class QuoteView(viewsets.ModelViewSet):
    lookup_value_regex = r"\d+"
    serializer_class = QuoteSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = (
            Quote.objects.filter(owner=self.request.user)
            .select_related("client")
            .prefetch_related("costs")
        )
        if self.request.query_params.get("status"):
            qs = qs.filter(status=self.request.query_params["status"])
        if self.request.query_params.get("search"):
            qs = qs.filter(title__icontains=self.request.query_params["search"])
        return qs

    def perform_create(self, serializer):
        with transaction.atomic():
            q = serializer.save(owner=self.request.user)
            changed(q, "Draft created")

    def update(self, request, *args, **kwargs):
        # Lock before applying the mutation; finalisation and updates serialize.
        with transaction.atomic():
            q = get_object_or_404(
                Quote.objects.select_for_update(), pk=kwargs["pk"], owner=request.user
            )
            if q.status != "draft":
                raise ValidationError(
                    "This version is immutable. Duplicate it to revise."
                )
            if not isinstance(request.data, dict):
                raise ValidationError("Send a JSON object.")
            if "version" in request.data:
                from rest_framework import serializers

                expected = serializers.IntegerField(min_value=1).run_validation(
                    request.data["version"]
                )
                if expected != q.version:
                    return Response(
                        {
                            "detail": "This draft changed in another request. Go back to reload the latest version before editing."
                        },
                        status=409,
                    )
            s = self.get_serializer(q, data=request.data, partial=True)
            s.is_valid(raise_exception=True)
            q = s.save()
            changed(q, "Draft inputs changed: version advanced")
            return Response(self.get_serializer(q).data)

    @action(detail=True, methods=["post"])
    def calculate(self, request, pk=None):
        q = self.get_object()
        request_serializer = CalculationRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        try:
            return Response(
                evaluate(q, refresh=request_serializer.validated_data["refresh"])
            )
        except CalculationConflict as e:
            return Response({"detail": str(e)}, status=409)
        except RateError as e:
            return Response({"detail": str(e)}, status=503)
        except ValueError as e:
            raise ValidationError(str(e))

    @action(detail=True, methods=["post"])
    def scenario(self, request, pk=None):
        from .pricing import scenarios
        from .services import inputs

        q = self.get_object()
        try:
            request_serializer = ScenarioRequestSerializer(data=request.data)
            request_serializer.is_valid(raise_exception=True)
            change = request_serializer.validated_data["change_percent"]
            if q.status == "archived":
                if not q.last_calculation:
                    raise ValueError(
                        "Create a draft revision to calculate this archived version."
                    )
                result = q.last_calculation
            else:
                result = q.snapshot if q.status == "finalised" else evaluate(q)
            data = inputs(q)
            return Response(
                scenarios(
                    data["costs"],
                    data["margin"],
                    data["fee"],
                    data["fixed"],
                    result["rate"],
                    q.currency,
                    result["gross_price"],
                    [change],
                )[0]
            )
        except CalculationConflict as e:
            return Response({"detail": str(e)}, status=409)
        except (RateError, ValueError) as e:
            raise ValidationError(str(e))

    @action(detail=True, methods=["post"])
    def plan(self, request, pk=None):
        from .pricing import calculate
        from .services import inputs

        q = self.get_object()
        serializer = PlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if q.status == "archived":
            raise ValidationError(
                "Create a draft revision to plan this archived quote."
            )
        result = q.snapshot if q.status == "finalised" else q.last_calculation
        if not result or (q.status == "draft" and self.get_serializer(q).freshness(q)):
            return Response(
                {"detail": "Calculate the latest draft before planning a new margin."},
                status=409,
            )
        data = inputs(q)
        data["margin"] = serializer.validated_data["target_margin"]
        data["proposed"] = None
        try:
            planned = calculate(**data, rate=result["rate"])
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(
            {
                **planned,
                "hypothetical": True,
                "input_version": q.version,
                "rate_provenance": result["rate_provenance"],
                "current_price": result["gross_price"],
            }
        )

    @action(detail=True, methods=["post"])
    def finalise(self, request, pk=None):
        q = self.get_object()
        if q.status != "draft":
            raise ValidationError("Only a draft can be finalised.")
        try:
            result = evaluate(q)
        except CalculationConflict as e:
            return Response({"detail": str(e)}, status=409)
        except RateError as e:
            return Response({"detail": str(e)}, status=503)
        except ValueError as e:
            raise ValidationError(str(e))
        version = q.version
        # External request completed before opening this transaction.
        with transaction.atomic():
            locked = Quote.objects.select_for_update().get(pk=q.pk, owner=request.user)
            if locked.status != "draft" or locked.version != version:
                return Response(
                    {"detail": "Draft changed during calculation. Please retry."},
                    status=409,
                )
            snapshot = {
                "quote": QuoteSerializer(locked, context={"request": request}).data,
                "calculation": result,
            }
            # Store calculation at top level for the same detail API response shape.
            locked.snapshot = {**result, "quotation": snapshot["quote"]}
            locked.status = "finalised"
            locked.version += 1
            locked.save()
            changed(locked, "Finalised immutable snapshot")
        return Response(self.get_serializer(locked).data)

    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        old = self.get_object()
        with transaction.atomic():
            old = (
                Quote.objects.select_for_update()
                .select_related("client")
                .get(pk=old.pk, owner=request.user)
            )
            data = QuoteSerializer(old, context={"request": request}).data
            for k in [
                "id",
                "client_name",
                "status",
                "revision",
                "version",
                "parent",
                "snapshot",
                "last_calculation",
                "created_at",
                "updated_at",
            ]:
                data.pop(k, None)
            s = QuoteSerializer(data=data, context={"request": request})
            s.is_valid(raise_exception=True)
            q = s.save(owner=request.user, parent=old, revision=old.revision + 1)
            changed(q, "New draft revision")
        return Response(
            QuoteSerializer(q, context={"request": request}).data, status=201
        )

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        with transaction.atomic():
            q = get_object_or_404(
                Quote.objects.select_for_update(), pk=pk, owner=request.user
            )
            if q.status != "draft":
                raise ValidationError(
                    "Only drafts may be archived; finalised versions remain immutable."
                )
            q.status = "archived"
            q.version += 1
            q.save()
            changed(q, "Draft archived")
        return Response(self.get_serializer(q).data)

    @action(detail=True, methods=["get"], url_path="export")
    def export_file(self, request, pk=None):
        q = self.get_object()
        if q.status != "finalised":
            raise ValidationError("Finalise this version before exporting.")
        s = q.snapshot
        meta = s["quotation"]
        if request.query_params.get("kind") == "csv":
            stream = io.StringIO()
            w = csv.writer(stream)
            w.writerow(
                ["INTERNAL BREAKDOWN", f"Quote {q.id}", f"Revision {q.revision}"]
            )
            w.writerow(["description", "quantity", "unit_cost_INR"])
            # Defuse spreadsheet formula interpretation in user-entered strings.
            for item in meta["costs"]:
                desc = item["description"]
                desc = "'" + desc if desc[:1] in "=+-@\t\r" else desc
                w.writerow([desc, item["quantity"], item["unit_cost"]])
            for field in [
                "cost",
                "gross_price",
                "fees",
                "net_revenue",
                "profit",
                "margin",
                "rate",
            ]:
                w.writerow([field, s[field]])
            response = HttpResponse(stream.getvalue(), content_type="text/csv")
            response["Content-Disposition"] = (
                f'attachment; filename="quoteguard-{q.id}-v{q.revision}-internal.csv"'
            )
            return response
        stream = io.BytesIO()
        doc = SimpleDocTemplate(
            stream,
            pagesize=(595, 842),
            leftMargin=48,
            rightMargin=48,
            topMargin=48,
            bottomMargin=48,
        )
        styles = getSampleStyleSheet()
        styles["Title"].textColor = colors.HexColor("#183e32")
        p = lambda txt, style="BodyText": Paragraph(
            escape(str(txt)).replace("\n", "<br/>"), styles[style]
        )
        contents = [
            p("QuoteGuard", "Title"),
            p("PROJECT QUOTATION", "Heading2"),
            Spacer(1, 22),
            p(f"QG-{q.id:04d} / Version {q.revision}"),
            p(f"Prepared for: {meta['client_name']}"),
            p(f"Valid until: {meta['valid_until']}"),
            Spacer(1, 24),
            p(meta["title"], "Heading1"),
            p(meta["description"]),
            Spacer(1, 22),
        ]
        table = Table(
            [[p("Project fee"), p(f"{s['gross_price']} {q.currency}")]],
            colWidths=[340, 159],
        )
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eef3eb")),
                    ("TOPPADDING", (0, 0), (-1, -1), 18),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
                ]
            )
        )
        contents.extend(
            [
                table,
                Spacer(1, 24),
                p("Terms & notes", "Heading2"),
                p(meta["notes"] or "Payment terms to be agreed with the client."),
                Spacer(1, 24),
                p(
                    "Taxes are not included or calculated. This quotation states the project price in the billing currency.",
                    "BodyText",
                ),
            ]
        )
        doc.build(contents)
        response = HttpResponse(stream.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = (
            f'attachment; filename="quoteguard-{q.id}-v{q.revision}.pdf"'
        )
        return response


@api_view(["GET", "POST"])
def lab(request):
    if request.method == "POST":
        request_serializer = LabRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        payload = request_serializer.validated_data
        operation = payload["operation"]
        if operation == "expiry":
            k = f"qg:lab:{request.user.id}:expiry"
            existing = cache.get(k)
            if payload["start"]:
                cache.set_value(k, {"synthetic_demo": True}, 3)
                existing = cache.get(k)
            return Response(
                {
                    "value": existing,
                    "ttl": cache.ttl(k),
                    "namespace": "owner-isolated demo",
                    "duration_ms": 0,
                }
            )
        if operation not in ["cold", "warm", "refresh"]:
            raise ValidationError("Choose cold, warm or refresh.")
        pair = payload["currency"]
        if pair not in MINOR:
            raise ValidationError("Unsupported currency.")
        if pair == "INR":
            return Response(lookup("INR", "INR", owner=request.user.id))
        # Cold experiments use an isolated namespace; the normal shared cache stays intact.
        if operation == "cold":
            from .rates import fetch

            start = time.perf_counter()
            try:
                row = fetch("INR", pair)
            except RateError as e:
                return Response({"detail": str(e)}, status=503)
            cache.metric(request.user.id, "miss")
            cache.metric(request.user.id, "upstream")
            cache.set_value(f"qg:lab:{request.user.id}:{pair}", row, 60)
            return Response(
                {
                    **row,
                    "cache": "isolated cold miss",
                    "ttl": 60,
                    "duration_ms": (time.perf_counter() - start) * 1000,
                }
            )
        start = time.perf_counter()
        if operation == "warm":
            row = cache.get(f"qg:lab:{request.user.id}:{pair}")
            if row:
                cache.metric(request.user.id, "hit")
                return Response(
                    {
                        **row,
                        "cache": "isolated warm hit",
                        "ttl": cache.ttl(f"qg:lab:{request.user.id}:{pair}"),
                        "duration_ms": (time.perf_counter() - start) * 1000,
                    }
                )
        try:
            row = lookup(
                "INR", pair, refresh=operation == "refresh", owner=request.user.id
            )
        except RateError as e:
            return Response({"detail": str(e)}, status=503)
        if operation == "refresh":
            AuditEvent.objects.create(
                owner=request.user,
                cause="Rate refresh: all dependent draft keys change; finalised snapshots untouched",
            )
        return Response(row)
    events = list(
        AuditEvent.objects.filter(owner=request.user)
        .order_by("-created_at")[:25]
        .values("cause", "created_at", "quote_id")
    )
    return Response({**cache.metrics(request.user.id), "events": events})
